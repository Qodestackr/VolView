import { defineStore } from 'pinia';
import { vec3, mat3, mat4 } from 'gl-matrix';
import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Bounds } from '@kitware/vtk.js/types';

import { useIdStore } from '@/src/store/id';
import { defaultLPSDirections, getLPSDirections } from '../utils/lps';
import { StateFile, DatasetType } from '../io/state-file/schema';
import { serializeData } from '../io/state-file/utils';
import { useFileStore } from './datasets-files';
import { ImageMetadata } from '../types/image';
import { compareImageSpaces } from '../utils/imageSpace';

export const defaultImageMetadata = () => ({
  name: '(none)',
  orientation: mat3.create(),
  lpsOrientation: defaultLPSDirections(),
  spacing: vec3.fromValues(1, 1, 1),
  origin: vec3.create(),
  dimensions: vec3.fromValues(1, 1, 1),
  worldBounds: [0, 1, 0, 1, 0, 1] as Bounds,
  worldToIndex: mat4.create(),
  indexToWorld: mat4.create(),
});

interface State {
  idList: string[]; // list of IDs
  dataIndex: Record<string, vtkImageData>; // ID -> VTK object
  metadata: Record<string, ImageMetadata>; // ID -> metadata
}

export const useImageStore = defineStore('images', {
  state: (): State => ({
    idList: [],
    dataIndex: Object.create(null),
    metadata: Object.create(null),
  }),
  actions: {
    addVTKImageData(name: string, imageData: vtkImageData, useId?: string) {
      if (useId && useId in this.dataIndex) {
        throw new Error('ID already exists');
      }

      const id = useId || useIdStore().nextId();

      this.idList.push(id);
      this.dataIndex[id] = imageData;

      this.metadata[id] = { ...defaultImageMetadata(), name };
      this.updateData(id, imageData);
      return id;
    },

    updateData(id: string, imageData: vtkImageData) {
      if (id in this.metadata) {
        const metadata: ImageMetadata = {
          name: this.metadata[id].name,
          dimensions: imageData.getDimensions() as vec3,
          spacing: imageData.getSpacing() as vec3,
          origin: imageData.getOrigin() as vec3,
          orientation: imageData.getDirection(),
          lpsOrientation: getLPSDirections(imageData.getDirection()),
          worldBounds: imageData.getBounds(),
          worldToIndex: imageData.getWorldToIndex(),
          indexToWorld: imageData.getIndexToWorld(),
        };

        this.metadata[id] = metadata;
        this.dataIndex[id] = imageData;
      }
      this.dataIndex[id] = imageData;
    },

    deleteData(id: string) {
      if (id in this.dataIndex) {
        this.dataIndex = Object.fromEntries(
          Object.entries(this.dataIndex).filter(([key]) => key !== id)
        );
        this.metadata = Object.fromEntries(
          Object.entries(this.metadata).filter(([key]) => key !== id)
        );
        this.idList = this.idList.filter((i) => i !== id);
      }
    },

    checkAllImagesSameSpace() {
      if (this.idList.length < 2) return false;

      const dataFirst = this.dataIndex[this.idList[0]];
      const allEqual = this.idList.slice(1).every((id) => {
        return compareImageSpaces(this.dataIndex[id], dataFirst);
      });

      return allEqual;
    },

    async serialize(stateFile: StateFile) {
      const fileStore = useFileStore();
      // We want to filter out volume images (which are generated and don't have
      // input files in fileStore with matching imageID.)
      const dataIDs = this.idList.filter((id) => id in fileStore.byDataID);

      await serializeData(stateFile, dataIDs, DatasetType.IMAGE);
    },
  },
});

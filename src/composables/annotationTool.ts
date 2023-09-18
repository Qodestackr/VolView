import { Ref, computed, ref, watch } from 'vue';
import { Vector2 } from '@kitware/vtk.js/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/utils';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { getCSSCoordinatesFromEvent } from '@/src//utils/vtk-helpers';
import { LPSAxis } from '@/src/types/lps';
import { AnnotationTool, ContextMenuEvent } from '@/src/types/annotation-tool';
import { usePopperState } from './usePopperState';

const SHOW_OVERLAY_DELAY = 250; // milliseconds

// does the tools's frame of reference match
// the view's axis
const useDoesToolFrameMatchViewAxis = <
  ToolID extends string,
  Tool extends AnnotationTool<ToolID>
>(
  viewAxis: Ref<LPSAxis>,
  tool: Partial<Tool>
) => {
  if (!tool.frameOfReference) return false;

  const { currentImageMetadata } = useCurrentImage();
  const toolAxis = frameOfReferenceToImageSliceAndAxis(
    tool.frameOfReference,
    currentImageMetadata.value,
    {
      allowOutOfBoundsSlice: true,
    }
  );
  return !!toolAxis && toolAxis.axis === viewAxis.value;
};

export const useCurrentTools = <ToolID extends string>(
  toolStore: AnnotationToolStore<ToolID>,
  viewAxis: Ref<LPSAxis>
) =>
  computed(() => {
    const { currentImageID } = useCurrentImage();
    const curImageID = currentImageID.value;

    return toolStore.tools.filter((tool) => {
      // only show tools for the current image,
      // current view axis and not hidden
      return (
        tool.imageID === curImageID &&
        useDoesToolFrameMatchViewAxis(viewAxis, tool) &&
        !tool.hidden
      );
    });
  });

// --- Context Menu --- //

export const useContextMenu = <ToolID extends string>() => {
  const contextMenu = ref<{
    open: (id: ToolID, e: ContextMenuEvent) => void;
  } | null>(null);
  const openContextMenu = (toolID: ToolID, event: ContextMenuEvent) => {
    if (!contextMenu.value)
      throw new Error('contextMenu component does not exist');
    contextMenu.value.open(toolID, event);
  };

  return { contextMenu, openContextMenu };
};

export const useRightClickContextMenu = (
  emit: (event: 'contextmenu', ...args: any[]) => void,
  widget: Ref<vtkAnnotationToolWidget | null>
) => {
  onVTKEvent(widget, 'onRightClickEvent', (eventData) => {
    const displayXY = getCSSCoordinatesFromEvent(eventData);
    if (displayXY) {
      emit('contextmenu', {
        displayXY,
        widgetActions: eventData.widgetActions,
      } satisfies ContextMenuEvent);
    }
  });
};

// --- Hover --- //

export const useHoverEvent = (
  emit: (event: 'widgetHover', ...args: any[]) => void,
  widget: Ref<vtkAnnotationToolWidget | null>
) => {
  onVTKEvent(widget, 'onHoverEvent', (eventData: any) => {
    const displayXY = getCSSCoordinatesFromEvent(eventData);
    if (displayXY) {
      emit('widgetHover', {
        displayXY,
        hovering: eventData.hovering,
      });
    }
  });
};

export type OverlayInfo<ToolID> =
  | {
      visible: false;
    }
  | {
      visible: true;
      toolID: ToolID;
      displayXY: Vector2;
    };

// Maintains list of tools' hover states.
// If one tool hovered, overlayInfo.visible === true with toolID and displayXY.
export const useHover = <ToolID extends string>(
  tools: Ref<Array<AnnotationTool<ToolID>>>,
  currentSlice: Ref<number>
) => {
  type Info = OverlayInfo<ToolID>;
  const toolHoverState = ref({}) as Ref<Record<ToolID, Info>>;

  const toolsOnCurrentSlice = computed(() =>
    tools.value.filter((tool) => tool.slice === currentSlice.value)
  );

  watch(toolsOnCurrentSlice, () => {
    // keep old hover states, default to false for new tools
    toolHoverState.value = toolsOnCurrentSlice.value.reduce(
      (toolsHovers, { id }) => {
        const state = toolHoverState.value[id] ?? {
          visible: false,
        };
        return Object.assign(toolsHovers, {
          [id]: state,
        });
      },
      {} as Record<ToolID, Info>
    );
  });

  const onHover = (id: ToolID, event: any) => {
    toolHoverState.value[id] = event.hovering
      ? {
          visible: true,
          toolID: id,
          displayXY: event.displayXY,
        }
      : {
          visible: false,
        };
  };

  // If hovering true, debounce showing overlay.
  // Immediately hide overlay if hovering false.
  const synchronousOverlayInfo = computed(() => {
    const visibleToolID = Object.keys(toolHoverState.value).find(
      (toolID) => toolHoverState.value[toolID as ToolID].visible
    ) as ToolID | undefined;

    return visibleToolID
      ? toolHoverState.value[visibleToolID]
      : ({ visible: false } as Info);
  });

  const { isSet: showOverlay, reset: resetOverlay } =
    usePopperState(SHOW_OVERLAY_DELAY);

  watch(synchronousOverlayInfo, resetOverlay);

  const overlayInfo = computed(() =>
    showOverlay.value
      ? synchronousOverlayInfo.value
      : ({ visible: false } as Info)
  );

  const toolStore = useToolStore();
  const noInfoWithoutSelect = computed(() => {
    if (toolStore.currentTool !== Tools.Select)
      return { visible: false } as Info;
    return overlayInfo.value;
  });

  return { overlayInfo: noInfoWithoutSelect, onHover };
};

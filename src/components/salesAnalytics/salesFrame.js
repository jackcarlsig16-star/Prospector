// sales-ia-v2 N2 - the one page frame every Sales tab shares: a fixed-height
// row under the tab row (sub-view switch left, the screen's tools portaled
// into FRAME_TOOLS_ID right). A screen's channel row sits directly under it.
export const FRAME_ROW_HEIGHT = 44;
export const FRAME_TOOLS_ID = 'sales-frame-tools';
// companies-v2 Stage 3: past the phone width the sub-view tabs keep their full width and a screen's wide tools scroll
// inside their slot instead (a shrinking tab row clipped its last tabs on People and Dashboard › Overview).
// FIX pipeline-390-toolbar-v1 T1: on a phone (<= 760 px) the frame is two rows - the tabs scroll inside the first, the
// screen's tools sit in the second (hidden while no screen has portaled anything into it) - so nothing overlaps. The
// slot's layout lives here, not inline, so the :empty rule can win.
export const FRAME_CSS = `[data-sales-subviews] { flex: 0 1 auto; } @media (min-width: 761px) { [data-sales-subviews] { flex-shrink: 0; } }
#${FRAME_TOOLS_ID} { flex: 1 1 auto; min-width: 0; height: ${FRAME_ROW_HEIGHT}px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; overflow-x: auto; overflow-y: hidden; }
@media (max-width: 760px) { [data-sales-subviews] { flex: none; width: 100%; } #${FRAME_TOOLS_ID} { flex: none; } #${FRAME_TOOLS_ID}:empty { display: none; } }`;

// sales-ia-v2 N2 - the one page frame every Sales tab shares: a fixed-height
// row under the tab row (sub-view switch left, the screen's tools portaled
// into FRAME_TOOLS_ID right). A screen's channel row sits directly under it.
export const FRAME_ROW_HEIGHT = 44;
export const FRAME_TOOLS_ID = 'sales-frame-tools';
// companies-v2 Stage 3: past the phone width the sub-view tabs keep their full width and a screen's wide tools scroll
// inside their slot instead (a shrinking tab row clipped its last tabs on People and Dashboard › Overview); on a phone
// the two share the row and the tabs scroll inside theirs.
export const FRAME_CSS = '[data-sales-subviews] { flex: 0 1 auto; } @media (min-width: 761px) { [data-sales-subviews] { flex-shrink: 0; } }';

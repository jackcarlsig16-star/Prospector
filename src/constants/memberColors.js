// sales-goals-v1 REV4 - member colors, assigned in workspace join order so
// a person keeps theirs and no two members share one. The first two are the
// mockup's (validated CVD-safe on the dark ground); the rest keep the same
// lightness and stay clear of the status and cohort hues.
export const MEMBER_COLORS = ['#6F8CF0', '#C97626', '#4FB0C6', '#B07CC6', '#8FB35A', '#D6788F'];
export const UNASSIGNED_COLOR = '#4A5462';
export function memberColor(index) {
  return index >= 0 ? MEMBER_COLORS[index % MEMBER_COLORS.length] : UNASSIGNED_COLOR;
}

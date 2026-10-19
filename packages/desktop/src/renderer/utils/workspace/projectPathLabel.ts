/**
 * Last two path segments (parent/current) of a workspace path or file URI, e.g.
 * "Sudda_Working/GameClient". Falls back to the last segment (or the raw path)
 * when fewer than two segments are present. Used to disambiguate folders that
 * share the same leaf name in pickers and the project list.
 */
export const getParentAndCurrentDir = (path: string): string => {
  let displayPath = path;
  if (/^file:\/\//i.test(path)) {
    displayPath = path.replace(/^file:\/\//i, '');
    try {
      displayPath = decodeURIComponent(displayPath);
    } catch {
      // Keep malformed URI escapes readable without breaking the group list.
    }
  }
  const parts = displayPath.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || path;
};

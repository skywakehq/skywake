/**
 * Skywake next to the two folders people already share. Each row is
 * [Google Drive, Dropbox, Skywake]; its words are `compare.rows` in messages.
 *
 * Keep these true of the products as they ship: Drive has no Linux client,
 * Dropbox does, and both make a "conflicted copy" when two writers collide.
 */
export const compareRows: [boolean, boolean, boolean][] = [
  [true, true, true], // Store large files
  [false, true, true], // Mount on a sandbox
  [false, false, true], // Agent native
  [false, false, true], // Parallel running agents
  [false, false, true], // Vector and full-text search
  [false, false, true], // Open source
];

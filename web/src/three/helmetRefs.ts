// Helmet colour references for the 2026 grid, from published descriptions of each driver's 2026
// race helmet (PlanetF1 2026 helmet round-up, Sky Sport Italia, Motorsport.com 2026 guide,
// auto motor und sport, Red Bull, and official/retail replica listings), gathered Nov 2026.
// Only the colours and the kind of motif are taken from the references; the artwork itself is our
// own simplified pattern. Hex values are approximations of the described colours.
// Drivers not listed here get their team's colours for the season shown.

export type Motif =
  | "halves"      // top and bottom in different colours
  | "bands"       // horizontal colour bands around the helmet at eye level
  | "flag"        // flag wrap around the sides, pattern on top
  | "flourish"    // one main colour with swooshes
  | "chrome"      // white with chrome panels
  | "slashes"     // multicolour diagonal slashes
  | "crownwings"; // wings on the crown

export interface HelmetRef {
  colors: [string, string, string, string?];
  motif: Motif;
  crown?: "stripe" | "triangles" | "wings" | "plain";
  note: string; // what the references say, shown on the profile
}

export const HELMET_REFS: Record<string, HelmetRef> = {
  "charles-leclerc": { colors: ["#d40018", "#f2f2f2", "#7cc4ea"], motif: "halves", crown: "plain", note: "Red upper half, white lower half (Monaco), light-blue accents." },
  "lewis-hamilton": { colors: ["#f2c200", "#d40018", "#111111"], motif: "flourish", crown: "stripe", note: "Yellow with red details, recalling his early career." },
  "lando-norris": { colors: ["#c8f51e", "#111111", "#ffffff"], motif: "flourish", crown: "stripe", note: "Fluorescent green-yellow and black." },
  "oscar-piastri": { colors: ["#0f2c66", "#d4202a", "#f2c230", "#ffffff"], motif: "bands", crown: "stripe", note: "Red, yellow and blue with the Australian flag." },
  "george-russell": { colors: ["#6ec6f0", "#111111", "#ffffff"], motif: "flourish", crown: "plain", note: "Sky blue throughout with black flourishes." },
  "kimi-antonelli": { colors: ["#1f5ea8", "#1a9b48", "#ffffff", "#d4202a"], motif: "bands", crown: "stripe", note: "Italian red, white and green on darker azzurro blue, with black." },
  "carlos-sainz-jr": { colors: ["#d4202a", "#f6c400", "#1b5fb4"], motif: "bands", crown: "stripe", note: "Red and yellow of Spain, with Williams blue." },
  "fernando-alonso": { colors: ["#4da3dc", "#d4202a", "#f6c400"], motif: "bands", crown: "plain", note: "Red, yellow and light blue: the flags of Spain and Asturias." },
  "liam-lawson": { colors: ["#f07ab4", "#111111", "#ffffff"], motif: "flourish", crown: "stripe", note: "Pink design." },
  "arvid-lindblad": { colors: ["#1e3ec0", "#47f05a", "#e62020", "#5fb8ff"], motif: "slashes", crown: "plain", note: "Multicoloured: neon green, shades of blue and red." },
  "isack-hadjar": { colors: ["#f5c800", "#6a2bb0", "#111111"], motif: "flourish", crown: "stripe", note: "Yellow, purple and black (was mostly neon green)." },
  "franco-colapinto": { colors: ["#74acdf", "#ffffff", "#111111", "#e8646a"], motif: "flag", crown: "triangles", note: "Argentinian flag wrap, black, light red and white, multicoloured triangles on top." },
  "alexander-albon": { colors: ["#f4f4f4", "#b9c0ca", "#0b3d91"], motif: "chrome", crown: "stripe", note: "White with large chrome sections, Williams blue and silver." },
  "gabriel-bortoleto": { colors: ["#f4f4f4", "#009c3b", "#ffdf00", "#d4a830"], motif: "crownwings", crown: "wings", note: "More white, Brazilian flag, golden wings on top." },
  "esteban-ocon": { colors: ["#cf1f2a", "#ffffff", "#111111"], motif: "flourish", crown: "plain", note: "Red." },
  "oliver-bearman": { colors: ["#1f4fb4", "#f6c400", "#ffffff"], motif: "flourish", crown: "stripe", note: "Blue and yellow." },
  "pierre-gasly": { colors: ["#1b4fa8", "#ffffff", "#f596c8"], motif: "flourish", crown: "plain", note: "Blue (no fuller description found)." },
  "max-verstappen": { colors: ["#172a5c", "#ff7a00", "#d4202a"], motif: "bands", crown: "stripe", note: "Long-running design based on his father's, glossier for 2026. Shades approximate." },
  "lance-stroll": { colors: ["#0b4d2e", "#ffffff", "#cedc00"], motif: "flourish", crown: "plain", note: "No 2026 description found; his usual British racing green." },
};

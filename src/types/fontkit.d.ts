declare module "fontkit" {
  interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function openSync(path: string): Font;
}

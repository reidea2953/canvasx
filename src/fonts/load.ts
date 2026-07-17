/**
 * Canvas does not wait for fonts.
 *
 * ctx.fillText with an unloaded family silently falls back to a system font,
 * and — worse — ctx.measureText then returns metrics for the WRONG font. Every
 * wrap, bound and hit box gets computed against the fallback, then visibly
 * reflows the moment the real font lands. This is the single most common
 * "my text is broken" bug in canvas apps.
 *
 * So: nothing renders until these resolve. font-display:block (not swap) means
 * a brief invisible period rather than a full canvas reflow mid-session.
 */
const FACES: [family: string, url: string][] = [
  ['Caveat', '/fonts/Caveat-Regular.woff2'],
  ['Nunito', '/fonts/Nunito-Regular.woff2'],
  ['JetBrainsMono', '/fonts/JetBrainsMono-Regular.woff2'],
];

export async function loadFonts(): Promise<void> {
  await Promise.all(
    FACES.map(async ([family, url]) => {
      try {
        const face = new FontFace(family, `url(${url})`, { display: 'block' });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        // A missing font must not take the whole app down; text will render in
        // the fallback family instead.
        console.error(`Font "${family}" failed to load from ${url}`, error);
      }
    }),
  );

  // Resolves once the faces added above are actually usable for measurement.
  await document.fonts.ready;
}

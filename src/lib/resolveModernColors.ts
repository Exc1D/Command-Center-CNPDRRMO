// html2canvas 1.x cannot parse OKLCH/OKLAB. Pass as `onclone` so the browser resolves colors in the export clone.
export function resolveModernColors(doc: Document) {
  const pixel = doc.createElement('canvas'); pixel.width = 1; pixel.height = 1;
  const context = pixel.getContext('2d')!;
  const converted = new Map<string, string>();
  const rgb = (value: string) => {
    if (!converted.has(value)) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      converted.set(value, 'rgba(' + [r, g, b, a / 255].join(',') + ')');
    }
    return converted.get(value)!;
  };
  doc.querySelectorAll<HTMLElement>('*').forEach(node => {
    const style = doc.defaultView!.getComputedStyle(node);
    for (const property of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', '-webkit-text-stroke-color', 'box-shadow', 'text-shadow']) {
      const value = style.getPropertyValue(property);
      if (/oklch|oklab|color\(/.test(value)) node.style.setProperty(property, value.replace(/(?:oklch|oklab|color)\([^)]*\)/g, rgb), 'important');
    }
  });
}

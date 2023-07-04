import React, { useContext, forwardRef, ReactNode, Ref, useEffect } from 'react';
import { Size } from '@lisb/pdfme-common';
import { FontContext } from '../contexts';
import Spinner from './Spinner';

type Props = { size: Size; scale: number; children: ReactNode };

const Root = ({ size, scale, children }: Props, ref: Ref<HTMLDivElement>) => {
  const font = useContext(FontContext);

  useEffect(() => {
    const fontFaces = Object.entries(font).map((entry) => {
      const [key, value] = entry;
      const fontFace = new FontFace(key, value.data);

      return fontFace.load();
    });
    Promise.all(fontFaces).then((loadedFontFaces) => {
      loadedFontFaces.forEach((loadedFontFace) => {
        // @ts-ignore
        if (document && document.fonts && document.fonts.add) {
          // @ts-ignore
          document.fonts.add(loadedFontFace);
        }
      });
    });
  }, [font]);

  return (
    <div
      ref={ref}
      style={{ position: 'relative', background: 'rgb(74, 74, 74)', overflow: 'overlay', ...size }}
    >
      <div style={{ margin: '0 auto', ...size }}>{scale === 0 ? <Spinner /> : children}</div>
    </div>
  );
};

export default forwardRef<HTMLDivElement, Props>(Root);

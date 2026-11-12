"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/kit";

// The worker must be set in the same module that renders the pages.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const GAP = 16;
// Pages this far from the one in view are drawn; the rest are blank boxes of the same size.
const AROUND = 3;

/**
 * A PDF drawn by pdf.js, one page under another. At 100% a page is at most
 * 720px wide, a comfortable reading size, and only the pages near the screen are drawn, so long files stay fast.
 */
export default function PdfView({ url, onFail }: { url: string; onFail: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [pages, setPages] = useState(0);
  const [ratio, setRatio] = useState(1.414);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(2);

  useEffect(() => {
    const box = scroller.current!;
    const observer = new ResizeObserver(() => setRoom(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const width = Math.round(Math.min(room - 48, 720) * ZOOMS[zoom]!);
  const height = Math.round(width * ratio);

  // Keep the same page in view when the zoom or the window changes the page size.
  const shown = useRef(1);
  useLayoutEffect(() => {
    scroller.current!.scrollTop = (shown.current - 1) * (height + GAP);
  }, [height]);

  function onScroll() {
    const box = scroller.current!;
    const at = Math.floor((box.scrollTop + box.clientHeight / 3) / (height + GAP)) + 1;
    shown.current = Math.min(pages, Math.max(1, at));
    setPage(shown.current);
  }

  return (
    <div className="absolute inset-0">
      <div ref={scroller} onScroll={onScroll} className="size-full overflow-auto py-6">
        {room > 0 && (
          <Document
            file={url}
            suspense={false}
            loading={<Note>Loading…</Note>}
            error={<Note>This PDF could not be read.</Note>}
            onLoadError={onFail}
            onLoadSuccess={async (pdf) => {
              const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
              setRatio(first.height / first.width);
              setPages(pdf.numPages);
            }}
            // gap-4 is GAP.
            className="grid justify-center gap-4"
          >
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className="bg-white" style={{ width, minHeight: height }}>
                {Math.abs(i + 1 - page) <= AROUND && (
                  <Page pageNumber={i + 1} width={width} suspense={false} loading="" />
                )}
              </div>
            ))}
          </Document>
        )}
      </div>
      {pages > 0 && (
        <div className="rounded-md absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 border bg-card px-1.5 text-xs tabular-nums">
          <span className="px-2 text-muted-foreground">
            {page} / {pages}
          </span>
          <span className="h-4 w-px bg-border" />
          <Button
            variant="plain"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom === 0}
            onClick={() => setZoom(zoom - 1)}
          >
            <Minus />
          </Button>
          <button onClick={() => setZoom(2)} className="w-11 text-center hover:text-foreground">
            {Math.round(ZOOMS[zoom]! * 100)}%
          </button>
          <Button
            variant="plain"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom === ZOOMS.length - 1}
            onClick={() => setZoom(zoom + 1)}
          >
            <Plus />
          </Button>
        </div>
      )}
    </div>
  );
}

function Note({ children }: { children: string }) {
  return <p className="py-20 text-center text-sm text-muted-foreground">{children}</p>;
}

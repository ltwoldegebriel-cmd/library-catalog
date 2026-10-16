import { useEffect, useRef, useState } from 'react';
import { isBookBarcode, checkIsbn } from '../lib/isbn';
import { Button } from './ui';

type Engine = 'native' | 'zxing';

/** Camera barcode scanner. BarcodeDetector where available, ZXing otherwise. */
export function Scanner({ onDetected }: { onDetected: (isbn13: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);

  async function start() {
    setError(''); setHint('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('The camera needs a secure (HTTPS) page. Type the ISBN below instead.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow it in your browser settings, or type the ISBN below.'
        : 'No camera found. Type the ISBN below.');
      return;
    }
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play().catch(() => {});
    setActive(true);
    let stopped = false;
    const finish = (code: string) => {
      const c = code.replace(/\D/g, '');
      if (isBookBarcode(c)) { stop(); onDetected(c); return true; }
      const chk = checkIsbn(c);
      if (chk.ok) { stop(); onDetected(chk.isbn13); return true; }
      setHint('That barcode is not a book ISBN. Try the barcode starting 978 or 979.');
      return false;
    };
    let cleanupEngine = () => {};
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cleanupEngine();
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      setActive(false);
    };
    stopRef.current = stop;

    const BD = (window as any).BarcodeDetector;
    let native = false;
    if (BD) {
      try {
        const formats: string[] = await BD.getSupportedFormats();
        native = formats.includes('ean_13');
      } catch { native = false; }
    }
    if (native) {
      setEngine('native');
      const detector = new BD({ formats: ['ean_13', 'upc_a'] });
      let timer = 0;
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          for (const c of codes) if (finish(c.rawValue)) return;
        } catch { /* frame not ready */ }
        timer = window.setTimeout(tick, 200);
      };
      tick();
      cleanupEngine = () => clearTimeout(timer);
    } else {
      setEngine('zxing');
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'), import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromVideoElement(video, res => {
        if (res && !stopped) finish(res.getText());
      });
      cleanupEngine = () => controls.stop();
    }
  }

  return (
    <div>
      <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-line bg-black/40">
        <video ref={videoRef} playsInline muted className={`absolute inset-0 w-full h-full object-cover ${active ? '' : 'hidden'}`} />
        {active ? (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-lg border-2 border-accent/80 pointer-events-none" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <svg width="56" height="40" viewBox="0 0 56 40" className="text-muted" aria-hidden>
              {[2, 6, 8, 13, 16, 18, 23, 27, 29, 33, 36, 40, 42, 47, 50, 53].map((x, i) => (
                <rect key={i} x={x} y="4" width={i % 3 === 0 ? 2.5 : 1.2} height="32" fill="currentColor" />
              ))}
            </svg>
            <p className="text-muted text-[15px] max-w-64">Point the camera at the barcode on the back cover.</p>
            <Button variant="primary" onClick={start}>Start camera</Button>
          </div>
        )}
      </div>
      {active && (
        <div className="flex items-center justify-between mt-3 gap-3">
          <span className="text-xs text-muted">Scanning with {engine === 'native' ? 'built-in detector' : 'ZXing'}</span>
          <Button variant="quiet" onClick={() => stopRef.current()}>Stop</Button>
        </div>
      )}
      {hint && <p className="text-sm text-accent mt-2">{hint}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
    </div>
  );
}

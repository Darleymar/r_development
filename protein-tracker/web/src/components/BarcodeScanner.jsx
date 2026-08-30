import { useEffect, useRef, useState } from 'react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * Kamera-Scan des EAN/GTIN-Codes.
 *
 * Bevorzugt die native BarcodeDetector-API (Chrome/Android, ohne Zusatzlast);
 * sonst wird @zxing/browser nachgeladen. Der Kamerazugriff funktioniert im
 * Browser nur ueber HTTPS – localhost ausgenommen. Ist das nicht gegeben,
 * bleibt die manuelle Eingabe des Codes.
 */
export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [message, setMessage] = useState(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let controls = null;
    let raf = null;

    const fail = (text, kind = 'error') => {
      if (stopped) return;
      setStatus(kind);
      setMessage(text);
    };

    const handle = (code) => {
      if (stopped || !code) return;
      stopped = true;
      onDetected(String(code).trim());
    };

    async function start() {
      if (!window.isSecureContext) {
        fail(
          'Der Browser gibt die Kamera nur über HTTPS frei (localhost ausgenommen). ' +
          'Barcode unten eintippen oder den Server mit Zertifikat starten.',
          'insecure'
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('Dieser Browser stellt keinen Kamerazugriff bereit.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err) {
        fail(
          err?.name === 'NotAllowedError'
            ? 'Kamerazugriff wurde abgelehnt. In den Browser-Einstellungen erlauben oder Barcode eintippen.'
            : 'Keine Kamera gefunden.'
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play().catch(() => {});
      setStatus('scanning');

      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length > 0) {
            const detector = new window.BarcodeDetector({ formats });
            const scan = async () => {
              if (stopped) return;
              try {
                const found = await detector.detect(video);
                if (found.length > 0) {
                  handle(found[0].rawValue);
                  return;
                }
              } catch { /* einzelne Frames duerfen fehlschlagen */ }
              raf = requestAnimationFrame(scan);
            };
            raf = requestAnimationFrame(scan);
            return;
          }
        } catch { /* faellt auf ZXing zurueck */ }
      }

      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) handle(result.getText());
        });
      } catch {
        fail('Der Barcode-Leser konnte nicht geladen werden. Code bitte eintippen.');
      }
    }

    start();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      controls?.stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="stack">
      {status !== 'error' && status !== 'insecure' && (
        <video ref={videoRef} className="scanner-video" muted playsInline aria-label="Kamerabild" />
      )}
      {status === 'starting' && <p className="small muted center">Kamera wird gestartet …</p>}
      {status === 'scanning' && <p className="small muted center">Barcode in den Bildausschnitt halten.</p>}
      {message && <div className={`banner ${status === 'insecure' ? 'banner-warn' : 'banner-error'}`}>{message}</div>}

      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault();
          const code = manual.trim();
          if (/^\d{8,14}$/.test(code)) onDetected(code);
        }}
      >
        <label className="field grow">
          <span>Barcode eintippen</span>
          <input
            inputMode="numeric"
            pattern="\d*"
            placeholder="z. B. 4056489123456"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}
                disabled={!/^\d{8,14}$/.test(manual.trim())}>
          Suchen
        </button>
      </form>

      <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>
    </div>
  );
}

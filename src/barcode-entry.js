// Barcode reading for phones without a built-in BarcodeDetector (iPhone, Firefox). Loaded only when needed.
import { BarcodeDetector, setZXingModuleOverrides } from 'barcode-detector/ponyfill';

setZXingModuleOverrides({
  locateFile: (path, prefix) => (path.endsWith('.wasm') ? new URL('zxing_reader.wasm', document.baseURI).href : prefix + path),
});

export default BarcodeDetector;

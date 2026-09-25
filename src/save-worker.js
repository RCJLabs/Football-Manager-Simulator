// Packs routine saves off the page's thread.
//
// Measured on a pro save at its peak, with the CPU slowed four times to stand
// in for a mid-range phone: deflating it takes 642 ms, and a watched game saves
// after nearly every play. Here that happens beside the page rather than in
// front of it; the page only serializes (136 ms) and writes the packed result
// (4 ms), which is less than the 288 ms an unpacked save used to cost it.
import { encode } from './savecodec.js';

self.onmessage = (e) => {
  const { gen, json } = e.data;
  try {
    self.postMessage({ gen, packed: encode(json, 6) });
  } catch (err) {
    self.postMessage({ gen, error: String((err && err.message) || err) });
  }
};

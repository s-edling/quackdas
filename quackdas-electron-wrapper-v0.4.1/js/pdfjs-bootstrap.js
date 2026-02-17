import * as pdfjsLib from './pdfjs/pdf.mjs';

// Expose for existing non-module code (js/pdf.js expects globalThis/window.pdfjsLib).
window.pdfjsLib = pdfjsLib;

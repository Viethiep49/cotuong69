// CLEAN-04: thiết lập chung cho test React (jsdom).
import '@testing-library/jest-dom/vitest';

// jsdom chưa cài scrollIntoView; ChatBox gọi hàm này khi có tin mới
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

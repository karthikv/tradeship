const ProgressBar = require("progress");

// Monkey patch terminate() so it doesn't throw an exception when the stream
// isn't a TTY. See: https://github.com/visionmedia/node-progress/pull/138
const terminate = ProgressBar.prototype.terminate;
ProgressBar.prototype.terminate = function() {
  if (!this.stream.isTTY) {
    return;
  }
  terminate.apply(this, arguments);
};

module.exports = ProgressBar;

import os from 'os'
import path from 'path'
import { execFile } from 'child_process'

const parseApk = (filename: string, cb: any) => {
  let exeName = null;
  if (os.type() === 'Darwin') {
    exeName = 'aapt-osx';
  } else if (os.type() === 'Linux') {
    exeName = 'aapt-linux';
  } else {
    throw new Error('Unknown OS!');
  }
  return execFile(path.join(__dirname ,exeName), ['dump', 'badging', filename], {
    maxBuffer: 1024 * 1024 * 1024
  }, function(err, out) {
    if (err) {
      return cb(err);
    }
    return parseOutput(out, cb);
  });
};

const parseOutput = (text: string, cb: any) => {
  var depth, element, indent, input, line;
  var matches, name, parent, parts, rest, type, value, _i, _len;
  if (!text) {
    return cb(new Error('No input!'));
  }
  var lines = text.split('\n');
  var result = {};
  for (var i = 0; i < lines.length; i++) {
    var kvs = lines[i].split(':')
    if (kvs.length == 2) {
      // @ts-ignore
      result[kvs[0]] = kvs[1];
    }
  }
  return cb(null, result);
};

parseApk.parseOutput = parseOutput;

export default parseApk
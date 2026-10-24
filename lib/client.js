// dsh-tailscale · Client 半区（手写 ModuleLoader bundle，无构建步骤、零运行时依赖）
// 设置 → 远程访问：Tailscale 状态 / 远程入口 / 登录链接 / 设备清单 / 诊断。
// 数据全部走同源 RPC：POST tailscale/<endpoint>（相对路径，不带前导 /）。
// 安全：登录链接含启动令牌，只存在于组件内存，不写 console / localStorage / 任何日志。
window.__ModuleLoader__.load({
  id: '@ponydev/dsh-tailscale',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'dsh-tailscale'
    const RPC_TIMEOUT_MS = 8000
    const LOGIN_TTL_MS = 60000
    const COPY_FLASH_MS = 1600

    // ---------------------------------------------------------------- 二维码（本地生成，内容不出本机）
    // vendored: qrcode-generator 1.4.4, Copyright (c) 2009 Kazuhiko Arase, MIT License
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();
    // ---------------------------------------------------------------- end vendored


    // ---------------------------------------------------------------- i18n
    const zh = {
      title: 'Tailscale',
      desc: '把本机 DSH Web 发布到 tailnet，用手机或其他设备访问',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '载入中…',
      retry: '重试',
      statusRunning: '运行中',
      statusNotInstalled: '未安装',
      statusNotRunning: '未运行',
      statusNotLoggedIn: '未登录',
      statusHttpsDisabled: 'HTTPS 未启用',
      statusRouteConflict: '路由冲突',
      statusTrustNotEffective: '信任未生效',
      statusUnknown: '未知',
      hintNotInstalled: '安装 Tailscale（standalone 版）后重试；CLI 不在 PATH 时可在插件配置里指定 cliPath。',
      hintNotRunning: '启动 Tailscale 后重试。',
      hintNotLoggedIn: '在 Tailscale 客户端登录后重试。',
      hintHttpsDisabled: '在 Tailscale 管理台启用 HTTPS 证书（需要先开启 MagicDNS）。',
      hintRouteConflict: '该域名或路径已被其他服务占用，先清理冲突的 serve 路由再开启入口。',
      hintTrustNotEffective: '信任未生效：重启 dsh web，或在启动参数里加 --trusted-host <节点域名>。',
      hintUnknown: '查看下方诊断项获取具体原因。',
      entryLabel: '入口',
      entryOn: '已开启',
      entryOff: '已关闭',
      entryWorking: '处理中…',
      backendLabel: '后端',
      targetLabel: '目标',
      valueNone: '—',
      entrySection: '远程入口',
      entryOffHint: '入口未开启：开启后才能从 tailnet 访问本机 DSH。',
      urlLabel: '入口 URL',
      loginTitle: '首次登录',
      generateLogin: '生成登录链接',
      generating: '生成中…',
      loginNotice: '链接含本次启动令牌，只发给可信设备。',
      loginHideIn: '{n} 秒后自动隐藏',
      loginUrlLabel: '登录链接',
      loginUnavailable: '入口未开启，无法生成登录链接',
      adoptedNote: '已认领上次运行残留的路由。',
      copy: '复制',
      copied: '已复制',
      copySelect: '已选中，请按复制快捷键',
      devicesTitle: '设备',
      deviceSummary: '{online} 在线 / {total} 总计',
      refreshDevices: '刷新设备',
      devicesEmpty: '暂无设备',
      selfBadge: '本机',
      offline: '离线',
      lastSeen: '最后在线 {t}',
      copyDomain: '复制域名',
      relJustNow: '刚刚',
      relMinAgo: '{n} 分钟前',
      relHourAgo: '{n} 小时前',
      relDayAgo: '{n} 天前',
      diagTitle: '诊断',
      recheck: '重新检查',
      checking: '检查中…',
      diagEmpty: '暂无检查项',
      healthOk: '全部正常',
      healthIssues: '{n} 项待处理',
      copyCommand: '复制命令',
      unauthorized: '未授权',
      unauthorizedHint: '请从已登录的 DSH 页面打开。',
      networkError: '网络请求失败',
      timeoutError: '请求超时',
      loadFailed: '加载失败',
      hostUnavailable: '宿主接口不可用',
      hostUnavailableHint: '确认插件已装入 DSH profile，然后重启 dsh web。',
      serveFailed: '入口创建失败',
      unknownError: '未知错误',
      unknownDevice: '未知设备',
      headerTitle: 'Tailscale',
      headerOnline: '在线',
      headerOffline: '离线',
      headerUnknown: '状态未知',
      headerEntryOn: '入口已开启',
      headerEntryOff: '入口未开启',
      headerDeviceCount: '{online}/{total} 设备在线',
      headerHint: '点击打开 Tailscale 设置',
      showEntryQr: '入口二维码',
      showLoginQr: '登录二维码',
      setupTitle: 'Tailscale 安装与启动',
      setupNotInstalled: '未安装',
      setupInstalled: '已安装',
      installButton: '安装 Tailscale',
      installing: '安装中…',
      installHint: '安装由系统执行（可能需要管理员授权）；首次运行还需要在系统设置里允许 VPN 配置。',
      setupMethod: '方式：{method}',
      setupCli: 'CLI：{path}',
      startButton: '启动 Tailscale',
      startHint: '已安装但未运行时可在这里拉起',
      allowAutoOff: 'allowAutoInstall 已关闭：请在插件配置里开启后再自动安装',
      loginSection: 'Tailscale 登录',
      loginHint: '本机 Tailscale 需要登录。可以扫码登录，也可以粘贴 auth key。',
      loginQr: '生成登录二维码',
      hideQr: '隐藏二维码',
      qrHint: '二维码由本机生成，内容不会上传；登录完成后自动失效',
      qrFailed: '二维码生成失败，可改用「打开浏览器」',
      openInBrowser: '打开浏览器',
      authKeyLabel: 'auth key',
      authKeyPlaceholder: 'tskey-auth-…',
      authKeyHint: '仅用于本次登录，不保存到配置或日志；也可以设置环境变量 TAILSCALE_AUTH_KEY',
      loginWithKey: '用 auth key 登录',
      loginKeyBusy: '登录中…',
      hostnameTitle: '节点主机名',
      hostnameHint: '当前生效的 hostname 来自 Tailscale 节点本身',
      hostnameImpact: '修改会影响整机节点名（SSH、serve 域名、其他服务都会跟着变）',
      hostnameSave: '保存',
      saving: '保存中…',
      hostnameConfirm: '确定把本机 Tailscale 节点名改成「{name}」？这会影响整台机器（SSH、serve 域名等）。',
      hostnameSaved: '已提交；节点名生效可能延迟几秒',
      updateTitle: '插件更新',
      updateNote: '仅检查并升级本插件（对比 npm 最新版），不影响 DSH 与其他插件。',
      checkUpdate: '检查更新',
      checkingUpdate: '检查中…',
      updateCheckFailed: '检查失败：{msg}',
      upToDate: '已是最新版本 v{version}',
      updateAvailable: '发现新版本 v{latest}',
      currentVersion: '当前版本',
      latestVersion: '最新版本',
      updateCommand: '升级命令',
      close: '关闭',
      retryCheck: '重新检查',


    }
    const en = {
      title: 'Tailscale',
      desc: 'Publish this DSH Web on your tailnet and open it from a phone or another device',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading…',
      retry: 'Retry',
      statusRunning: 'Running',
      statusNotInstalled: 'Not installed',
      statusNotRunning: 'Not running',
      statusNotLoggedIn: 'Not signed in',
      statusHttpsDisabled: 'HTTPS not enabled',
      statusRouteConflict: 'Route conflict',
      statusTrustNotEffective: 'Trust not applied',
      statusUnknown: 'Unknown',
      hintNotInstalled: 'Install Tailscale (standalone build) and retry; if the CLI is not on PATH, set cliPath in the plugin config.',
      hintNotRunning: 'Start Tailscale, then retry.',
      hintNotLoggedIn: 'Sign in to the Tailscale client, then retry.',
      hintHttpsDisabled: 'Enable HTTPS certificates in the Tailscale admin console (MagicDNS must be on).',
      hintRouteConflict: 'This domain or path is already used by another service. Clear the conflicting serve route first.',
      hintTrustNotEffective: 'Trust not applied: restart dsh web, or add --trusted-host <node domain> to the launch command.',
      hintUnknown: 'See the diagnostics below for details.',
      entryLabel: 'Entry',
      entryOn: 'On',
      entryOff: 'Off',
      entryWorking: 'Working…',
      backendLabel: 'Backend',
      targetLabel: 'Target',
      valueNone: '—',
      entrySection: 'Remote entry',
      entryOffHint: 'Entry is off: enable it to reach this DSH from your tailnet.',
      urlLabel: 'Entry URL',
      loginTitle: 'First sign-in',
      generateLogin: 'Generate sign-in link',
      generating: 'Generating…',
      loginNotice: 'The link contains this launch token; share it only with trusted devices.',
      loginHideIn: 'Hides in {n}s',
      loginUrlLabel: 'Sign-in link',
      loginUnavailable: 'Entry is off, cannot generate a sign-in link',
      adoptedNote: 'Adopted a route left by a previous run.',
      copy: 'Copy',
      copied: 'Copied',
      copySelect: 'Selected — press the copy shortcut',
      devicesTitle: 'Devices',
      deviceSummary: '{online} online / {total} total',
      refreshDevices: 'Refresh devices',
      devicesEmpty: 'No devices',
      selfBadge: 'This device',
      offline: 'Offline',
      lastSeen: 'Last seen {t}',
      copyDomain: 'Copy domain',
      relJustNow: 'just now',
      relMinAgo: '{n} min ago',
      relHourAgo: '{n} h ago',
      relDayAgo: '{n} d ago',
      diagTitle: 'Diagnostics',
      recheck: 'Re-check',
      checking: 'Checking…',
      diagEmpty: 'No checks',
      healthOk: 'All good',
      healthIssues: '{n} need attention',
      copyCommand: 'Copy command',
      unauthorized: 'Unauthorized',
      unauthorizedHint: 'Open this page from a signed-in DSH session.',
      networkError: 'Network request failed',
      timeoutError: 'Request timed out',
      loadFailed: 'Failed to load',
      hostUnavailable: 'Host API unavailable',
      hostUnavailableHint: 'Make sure the plugin is installed in the DSH profile, then restart dsh web.',
      serveFailed: 'Could not create entry',
      unknownError: 'Unknown error',
      unknownDevice: 'Unknown device',
      headerTitle: 'Tailscale',
      headerOnline: 'Online',
      headerOffline: 'Offline',
      headerUnknown: 'Status unavailable',
      headerEntryOn: 'Entry on',
      headerEntryOff: 'Entry off',
      headerDeviceCount: '{online}/{total} devices online',
      headerHint: 'Open Tailscale settings',
      showEntryQr: 'Entry QR',
      showLoginQr: 'Sign-in QR',
      setupTitle: 'Tailscale installation',
      setupNotInstalled: 'Not installed',
      setupInstalled: 'Installed',
      installButton: 'Install Tailscale',
      installing: 'Installing…',
      installHint: 'Installation runs on the system (admin approval may be required); after the first launch you still need to allow VPN configuration in System Settings.',
      setupMethod: 'Method: {method}',
      setupCli: 'CLI: {path}',
      startButton: 'Start Tailscale',
      startHint: 'Starts Tailscale when installed but not running',
      allowAutoOff: 'allowAutoInstall is off: enable it in the plugin config to install automatically',
      loginSection: 'Tailscale login',
      loginHint: 'This machine is not signed in. Scan the QR code or paste an auth key.',
      loginQr: 'Show login QR',
      hideQr: 'Hide QR',
      qrHint: 'The QR code is generated locally and never uploaded; it expires after login',
      qrFailed: 'Could not render the QR code; use "Open in browser" instead',
      openInBrowser: 'Open in browser',
      authKeyLabel: 'auth key',
      authKeyPlaceholder: 'tskey-auth-…',
      authKeyHint: 'Used for this login only; never stored in config or logs. You can also set TAILSCALE_AUTH_KEY.',
      loginWithKey: 'Sign in with auth key',
      loginKeyBusy: 'Signing in…',
      hostnameTitle: 'Node hostname',
      hostnameHint: 'The active hostname belongs to the Tailscale node itself',
      hostnameImpact: 'Changing it renames the whole machine (SSH, serve domain, other services).',
      hostnameSave: 'Save',
      saving: 'Saving…',
      hostnameConfirm: 'Rename this machine\'s Tailscale node to "{name}"? This affects the whole machine (SSH, serve domain, etc.).',
      hostnameSaved: 'Submitted; the new name may take a few seconds to apply',
      updateTitle: 'Plugin update',
      updateNote: 'Checks and upgrades only this plugin (against the npm latest version); DSH and other plugins are untouched.',
      checkUpdate: 'Check for updates',
      checkingUpdate: 'Checking…',
      updateCheckFailed: 'Check failed: {msg}',
      upToDate: 'Up to date (v{version})',
      updateAvailable: 'New version available: v{latest}',
      currentVersion: 'Current',
      latestVersion: 'Latest',
      updateCommand: 'Upgrade command',
      close: 'Close',
      retryCheck: 'Check again',


    }

    // 活动语言：优先读 DSH 写在 <html lang> 上的值，其次浏览器语言，最后英文。
    // 设置页槽位会通过 props.t 提供框架翻译；t 缺失时用本地字典兜底。
    function activeLang() {
      const doc = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || ''
      const tag = String(doc).toLowerCase()
      if (tag) return tag.startsWith('zh') ? 'zh' : 'en'
      const nav = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase()
      return nav.startsWith('zh') ? 'zh' : 'en'
    }
    const LOCALE_TICK = { subs: new Set() }
    function useLocaleTick() {
      const [, bump] = useState(0)
      useEffect(() => {
        const fn = () => bump((n) => n + 1)
        LOCALE_TICK.subs.add(fn)
        return () => { LOCALE_TICK.subs.delete(fn) }
      }, [])
    }
    function formatVars(text, vars) {
      if (!vars) return text
      let out = text
      for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]))
      return out
    }
    function trWith(t) {
      if (typeof t === 'function') {
        return (key, vars) => {
          let out = null
          try { out = vars ? t(key, vars) : t(key) } catch (e) { out = null }
          if (out != null && out !== key) return out
          const d = activeLang() === 'zh' ? zh : en
          return formatVars(d[key] != null ? d[key] : (en[key] != null ? en[key] : key), vars)
        }
      }
      const d = activeLang() === 'zh' ? zh : en
      return (key, vars) => formatVars(d[key] != null ? d[key] : (en[key] != null ? en[key] : key), vars)
    }

    // ---------------------------------------------------------------- RPC
    function rpcErr(kind, code, message, status) {
      const e = new Error(message || kind || 'rpc failed')
      e.kind = kind || 'unknown'
      e.code = code || ''
      e.status = status || 0
      return e
    }
    function isAbortError(e) {
      if (!e) return false
      if (e.name === 'AbortError') return true
      // 某些浏览器的 DOMException 只给 code 20（ABORT_ERR）
      return e.code === 20
    }
    // 所有请求：AbortController + 8s 超时；HTTP 401/403 = 未授权 / 围栏拒绝。
    async function post(endpoint, payload) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort() } catch (e) {} }, RPC_TIMEOUT_MS) : null
      try {
        let res
        try {
          res = await fetch('tailscale/' + endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload || {}),
            credentials: 'same-origin',
            signal: ctrl ? ctrl.signal : undefined,
          })
        } catch (e) {
          if (isAbortError(e)) throw rpcErr('timeout', 'tailscale/timeout', 'timeout', 0)
          throw rpcErr('network', 'tailscale/no-connection', 'network', 0)
        }
        if (res.status === 401 || res.status === 403) {
          throw rpcErr('unauthorized', 'tailscale/permission', 'unauthorized', res.status)
        }
        if (!res.ok) {
          const kind = res.status === 404 ? 'unavailable' : 'http'
          throw rpcErr(kind, '', 'HTTP ' + res.status, res.status)
        }
        let body = null
        try {
          body = await res.json()
        } catch (e) {
          if (isAbortError(e)) throw rpcErr('timeout', 'tailscale/timeout', 'timeout', 0)
          throw rpcErr('shape', '', 'invalid response', res.status)
        }
        if (body && body.ok) return body.value
        const error = (body && body.error) || {}
        const code = typeof error.code === 'string' ? error.code : ''
        const message = typeof error.message === 'string' ? error.message : ''
        if (code === 'tailscale/permission') throw rpcErr('unauthorized', code, message || 'unauthorized', res.status)
        throw rpcErr('rpc', code, message || code || ('rpc failed: ' + endpoint), res.status)
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    const api = {
      snapshot: (opts) => post('snapshot', opts || {}),
      health: (opts) => post('health', opts || {}),
      loginUrl: () => post('login-url', {}),
      publish: (opts) => post('publish', opts || {}),
      unpublish: () => post('unpublish', {}),
      devices: (opts) => post('devices', opts || {}),
      status: () => post('status', {}),
      setup: () => post('setup', {}),
      install: () => post('install', {}),
      start: () => post('start', {}),
      authUrl: () => post('auth-url', {}),
      login: (payload) => post('login', payload || {}),
      setHostname: (payload) => post('hostname', payload || {}),
      updateCheck: (force) => post('update-check', { force: !!force }),
    }

    // ---------------------------------------------------------------- 归一化（字段缺失 = 空态，不崩）
    function asObj(v) {
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    }
    function asStr(v) {
      return typeof v === 'string' ? v : ''
    }
    function asStrList(v) {
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []
    }
    function normDevice(d) {
      const o = asObj(d)
      const hostName = asStr(o.hostName)
      const dnsName = asStr(o.dnsName)
      return {
        id: asStr(o.id) || dnsName || hostName,
        hostName,
        dnsName,
        ips: asStrList(o.ips),
        os: asStr(o.os),
        online: !!o.online,
        tags: asStrList(o.tags),
        lastSeen: o.lastSeen,
        direct: !!o.direct,
        relay: asStr(o.relay),
        isSelf: !!o.isSelf,
      }
    }
    function normPublication(p) {
      const o = asObj(p)
      return {
        enabled: !!o.enabled,
        url: asStr(o.url),
        path: asStr(o.path),
        target: asStr(o.target),
        owned: !!o.owned,
        adopted: !!o.adopted,
        createdAt: o.createdAt,
        host: asStr(o.host),
        // Host 侧 classifyServe 四态：absent / exact / stale / conflict / unknown
        routeState: asStr(o.routeState),
        reason: asStr(o.reason),
        conflict: !!o.conflict,
      }
    }
    function normCheck(c) {
      const o = asObj(c)
      let level = o.level === 'ok' || o.level === 'warn' || o.level === 'error' ? o.level : ''
      let ok = typeof o.ok === 'boolean' ? o.ok : level !== 'warn' && level !== 'error'
      if (!level) level = ok ? 'ok' : 'warn'
      if (ok && level !== 'ok') level = 'ok'
      return {
        id: asStr(o.id),
        ok,
        level,
        message: asStr(o.message),
        hint: asStr(o.hint),
        command: asStr(o.command),
      }
    }
    function normHealth(hv) {
      const o = asObj(hv)
      const checks = Array.isArray(o.checks) ? o.checks.map(normCheck).filter((c) => c.id || c.message) : []
      const ok = typeof o.ok === 'boolean' ? o.ok : checks.every((c) => c.ok)
      return { ok, checks }
    }
    function normSetupState(v) {
      const o = asObj(v)
      return {
        running: !!o.running,
        phase: asStr(o.phase) || 'idle',
        method: asStr(o.method),
        startedAt: Number(o.startedAt) || 0,
        endedAt: Number(o.endedAt) || 0,
        error: o.error && typeof o.error === 'object'
          ? { code: asStr(o.error.code), message: asStr(o.error.message) }
          : null,
        log: asStrList(o.log).slice(-12),
      }
    }

    function normSetup(v) {
      const o = asObj(v)
      return {
        installed: !!o.installed,
        cliPath: asStr(o.cliPath),
        appPath: asStr(o.appPath),
        platform: asStr(o.platform),
        method: asStr(o.method),
        canAutoInstall: !!o.canAutoInstall,
        allowAutoInstall: o.allowAutoInstall !== false,
        source: asStr(o.source),
        state: normSetupState(o.state),
      }
    }

    function normSnapshot(v) {
      const o = asObj(v)
      const st = asObj(o.status)
      const self = asObj(st.self)
      const cfg = asObj(o.config)
      const dnsName = asStr(st.dnsName) || asStr(self.dnsName)
      return {
        status: {
          backend: asStr(st.backend),
          version: asStr(st.version),
          cliPath: asStr(st.cliPath),
          needsLogin: asStr(st.backend) === 'NeedsLogin',
          dnsName,
          // Host 在 status 读不到时把错误塞进 snapshot.status.error（snapshot 本身仍 ok:true）
          error: st.error && typeof st.error === 'object'
            ? { code: asStr(st.error.code), message: asStr(st.error.message) }
            : null,
          self: {
            hostName: asStr(self.hostName),
            dnsName: asStr(self.dnsName) || dnsName,
            ips: asStrList(self.ips),
            os: asStr(self.os),
            online: !!self.online,
            isSelf: self.isSelf !== false,
          },
        },
        setup: normSetup(o.setup),
        publication: normPublication(o.publication),
        devices: Array.isArray(o.devices) ? o.devices.map(normDevice) : [],
        health: normHealth(o.health),
        config: {
          autoPublish: !!cfg.autoPublish,
          httpsPort: cfg.httpsPort,
          publishPath: asStr(cfg.publishPath),
          trustHost: !!cfg.trustHost,
        },
      }
    }
    const EMPTY_SNAPSHOT = normSnapshot(null)

    // ---------------------------------------------------------------- 时间 / 状态
    function parseTime(v) {
      if (v == null || v === '') return 0
      if (typeof v === 'number') return v > 1e12 ? v : v * 1000
      const n = Date.parse(String(v))
      return isFinite(n) ? n : 0
    }
    function relText(v, tr) {
      const t = parseTime(v)
      if (!t) return ''
      const d = new Date(t)
      if (isNaN(d.getTime()) || d.getFullYear() < 2000) return ''
      const diff = Date.now() - t
      if (diff < 0) return ''
      if (diff < 60000) return tr('relJustNow')
      if (diff < 3600000) return tr('relMinAgo', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return tr('relHourAgo', { n: Math.floor(diff / 3600000) })
      return tr('relDayAgo', { n: Math.floor(diff / 86400000) })
    }
    const STATUS_HINTS = {
      statusRunning: '',
      statusNotInstalled: 'hintNotInstalled',
      statusNotRunning: 'hintNotRunning',
      statusNotLoggedIn: 'hintNotLoggedIn',
      statusHttpsDisabled: 'hintHttpsDisabled',
      statusRouteConflict: 'hintRouteConflict',
      statusTrustNotEffective: 'hintTrustNotEffective',
      statusUnknown: 'hintUnknown',
    }
    const STATUS_TONES = {
      statusRunning: 'ok',
      statusNotInstalled: 'err',
      statusNotRunning: 'warn',
      statusNotLoggedIn: 'warn',
      statusHttpsDisabled: 'warn',
      statusRouteConflict: 'err',
      statusTrustNotEffective: 'warn',
      statusUnknown: 'idle',
    }
    const ERROR_STATUS = {
      'tailscale/not-installed': 'statusNotInstalled',
      'tailscale/not-running': 'statusNotRunning',
      'tailscale/not-logged-in': 'statusNotLoggedIn',
      'tailscale/https-disabled': 'statusHttpsDisabled',
      'tailscale/route-conflict': 'statusRouteConflict',
      'tailscale/trust-unavailable': 'statusTrustNotEffective',
    }
    const CODE_TEXT = {
      'tailscale/not-installed': 'statusNotInstalled',
      'tailscale/not-running': 'statusNotRunning',
      'tailscale/not-logged-in': 'statusNotLoggedIn',
      'tailscale/https-disabled': 'statusHttpsDisabled',
      'tailscale/serve-failed': 'serveFailed',
      'tailscale/route-conflict': 'statusRouteConflict',
      'tailscale/trust-unavailable': 'statusTrustNotEffective',
      'tailscale/permission': 'unauthorizedHint',
      'tailscale/timeout': 'timeoutError',
      'tailscale/no-connection': 'networkError',
      'tailscale/no-publication': 'loginUnavailable',
    }
    function checksOf(snap) {
      const hv = snap && snap.health
      return hv && Array.isArray(hv.checks) ? hv.checks : []
    }
    function checkById(checks, id) {
      for (const c of checks) if (c && c.id === id) return c
      return null
    }
    // 状态语言（§8）：正常 / 未安装 / 未运行 / 未登录 / HTTPS 未启用 / 路由冲突 / 信任未生效 / 未知。
    function statusInfo(snap) {
      const st = (snap && snap.status) || {}
      const pub = (snap && snap.publication) || {}
      const backend = typeof st.backend === 'string' ? st.backend.toLowerCase() : ''
      const statusErrCode = st.error && st.error.code ? String(st.error.code) : ''
      const checks = checksOf(snap)
      const cli = checkById(checks, 'cli')
      const dnsCheck = checkById(checks, 'dnsName')
      const trust = checkById(checks, 'trust')
      let key = 'statusRunning'
      let checkId = null
      if (statusErrCode) {
        const mapped = ERROR_STATUS[statusErrCode]
        key = mapped || 'statusUnknown'
        checkId = key === 'statusNotInstalled' ? 'cli' : key === 'statusNotRunning' || key === 'statusNotLoggedIn' ? 'backend' : null
      } else if (backend.indexOf('install') >= 0 || (cli && cli.ok === false && !st.cliPath)) {
        key = 'statusNotInstalled'
        checkId = 'cli'
      } else if (backend === 'needslogin' || backend === 'needsmachineauth') {
        key = 'statusNotLoggedIn'
        checkId = 'backend'
      } else if (backend && backend !== 'running' && backend !== 'unknown') {
        key = 'statusNotRunning'
        checkId = 'backend'
      } else if (!backend || backend === 'unknown') {
        if (cli && cli.ok === false) {
          key = 'statusNotInstalled'
          checkId = 'cli'
        } else {
          key = 'statusUnknown'
        }
      } else if (pub.reason === 'no-dns-name' || (dnsCheck && dnsCheck.ok === false)) {
        key = 'statusHttpsDisabled'
        checkId = 'dnsName'
      } else if (pub.routeState === 'conflict') {
        key = 'statusRouteConflict'
        checkId = 'route'
      } else if (pub.enabled && trust && trust.ok === false) {
        // 入口开着但 trustedHosts 没生效 → 远程 /api 会 403
        key = 'statusTrustNotEffective'
        checkId = 'trust'
      }
      return { key, tone: STATUS_TONES[key] || 'idle', hintKey: STATUS_HINTS[key] || '', checkId }
    }
    function errorText(err, tr) {
      const kind = err && err.kind ? err.kind : 'unknown'
      if (kind === 'unauthorized') return tr('unauthorizedHint')
      if (kind === 'timeout') return tr('timeoutError')
      if (kind === 'network') return tr('networkError')
      if (kind === 'unavailable') return tr('hostUnavailableHint')
      const code = err && err.code ? String(err.code) : ''
      if (code && CODE_TEXT[code]) {
        const label = tr(CODE_TEXT[code])
        const msg = err && err.message ? String(err.message) : ''
        return msg && msg !== label ? label + ' · ' + msg : label
      }
      if (err && err.message) return String(err.message)
      return tr('unknownError')
    }
    function statusFromErrorCode(err) {
      const code = err && err.code ? String(err.code) : ''
      const key = ERROR_STATUS[code]
      return key ? { key, hintKey: STATUS_HINTS[key] || '' } : null
    }
    function sortDevices(list) {
      return list.slice().sort((a, b) => {
        const ao = a.online ? 0 : 1
        const bo = b.online ? 0 : 1
        if (ao !== bo) return ao - bo
        const as = a.isSelf ? 0 : 1
        const bs = b.isSelf ? 0 : 1
        if (as !== bs) return as - bs
        return String(a.hostName || a.dnsName || '').localeCompare(String(b.hostName || b.dnsName || ''))
      })
    }

    // ---------------------------------------------------------------- 剪贴板
    async function writeClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (e) {}
      return false
    }
    // 降级：选中节点（输入框用 select()，普通节点用 Range）
    function selectNode(el) {
      if (!el) return false
      try {
        if (typeof el.select === 'function') {
          el.focus()
          el.select()
          return true
        }
        const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null)
        if (!doc || typeof doc.createRange !== 'function') return false
        const range = doc.createRange()
        range.selectNodeContents(el)
        const view = doc.defaultView
        const sel = view && typeof view.getSelection === 'function' ? view.getSelection() : (typeof doc.getSelection === 'function' ? doc.getSelection() : null)
        if (!sel) return false
        sel.removeAllRanges()
        sel.addRange(range)
        return true
      } catch (e) {
        return false
      }
    }

    // ---------------------------------------------------------------- css（只用 --dsw-* 主题 token，fallback 除外）
    const CSS = `
.dst-root{display:flex;flex-direction:column;gap:16px;padding:0;color:var(--dsw-alias-label-primary,#191f28);font-size:13px;line-height:1.5}
.dst-shead{display:flex;align-items:flex-start;gap:12px}
.dst-shead-main{min-width:0;flex:1 1 auto}
.dst-title{font-size:16px;font-weight:650;margin:0;color:var(--dsw-alias-label-primary,#191f28)}
.dst-desc{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-shead-actions{display:flex;align-items:center;gap:8px;flex:none}
.dst-body{display:flex;flex-direction:column;gap:16px}
.dst-card{background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1,#e3e7ed));border-radius:var(--dsw-radius-lg,14px);padding:14px 16px}
.dst-card-head{display:flex;align-items:center;gap:8px;min-height:24px}
.dst-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28)}
.dst-card-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#637182);font-variant-numeric:tabular-nums}
.dst-card-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.dst-grow{flex:1 1 auto;min-width:0}
.dst-status-head{display:flex;align-items:center;gap:8px;min-height:24px}
.dst-status-label{font-size:14px;font-weight:600}
.dst-tone-ok .dst-status-label{color:var(--dsw-alias-label-primary,#191f28)}
.dst-tone-warn .dst-status-label{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#b45309))}
.dst-tone-err .dst-status-label{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-tone-idle .dst-status-label{color:var(--dsw-alias-label-secondary,#637182)}
.dst-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.dst-dot.ok{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-dot.warn{background:var(--dsw-alias-state-warn-primary,#f79009)}
.dst-dot.err{background:var(--dsw-alias-state-error-primary,#f04438)}
.dst-dot.idle{background:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-mono{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px}
.dst-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-mutedline{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-hintline{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-hintline.warn{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dst-hintline.err{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-switch{position:relative;flex:none;width:38px;height:22px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d8dce2);background:var(--dsw-alias-bg-layer-2,#f1f2f4);cursor:pointer;transition:background .16s ease}
.dst-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary,#12b76a);border-color:transparent}
.dst-switch:disabled{opacity:.55;cursor:default}
.dst-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(2,6,16,.18));transition:transform .16s ease;display:block}
.dst-switch[aria-checked="true"] .dst-knob{transform:translateX(16px)}
.dst-field{margin-top:10px}
.dst-field-row{display:flex;align-items:center;gap:8px}
.dst-input{flex:1 1 auto;min-width:0;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-base,#f6f7f9);color:var(--dsw-alias-label-primary,#191f28);font:inherit;font-size:12px;outline:none}
.dst-input:focus{border-color:var(--dsw-alias-state-business-primary,#4176E6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 18%,transparent)}
.dst-btn{flex:none;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#191f28);font:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap}
.dst-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.dst-btn:disabled{opacity:.55;cursor:default}
.dst-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176E6));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
.dst-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary,#4176E6))}
.dst-btn:focus-visible,.dst-switch:focus-visible,.dst-copy:focus-visible,.dst-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176E6));outline-offset:2px}
.dst-copy{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dst-copy:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5);color:var(--dsw-alias-label-secondary,#637182)}
.dst-notice{margin-top:8px;font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#b45309)}
.dst-login{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,#e3e7ed)}
.dst-login-head{display:flex;align-items:center;gap:8px}
.dst-login-head .dst-btn{margin-left:auto}
.dst-login-url{margin-top:4px}
.dst-list{display:flex;flex-direction:column;gap:2px;margin-top:10px}
.dst-dev{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-md,10px);min-height:36px}
.dst-dev:hover{background:var(--dsw-alias-interactive-bg-hover,#f4f5f7)}
.dst-dev-main{flex:1 1 auto;min-width:0}
.dst-dev-top{display:flex;align-items:center;gap:6px;min-width:0}
.dst-dev-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-dev-meta{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-dev-domain{color:var(--dsw-alias-label-secondary,#637182);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dst-dev-off{flex:none;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary,#98a2b3);background:var(--dsw-alias-bg-layer-2,#f1f2f4);border-radius:999px;padding:1px 6px}
.dst-badge{flex:none;font-size:10px;font-weight:600;color:var(--dsw-alias-state-business-primary,#4176E6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 10%,transparent);border-radius:999px;padding:1px 6px}
.dst-tags{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.dst-tag{font-size:10px;color:var(--dsw-alias-label-secondary,#637182);border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:5px;padding:0 4px;line-height:15px}
.dst-sep{color:var(--dsw-alias-label-tertiary,#c0c4cc)}
.dst-dev-actions{flex:none;display:flex;align-items:center}
.dst-checks{display:flex;flex-direction:column;margin-top:6px}
.dst-check{display:flex;align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3)}
.dst-check:last-child{border-bottom:0;padding-bottom:2px}
.dst-check-ico{flex:none;width:16px;height:16px;line-height:16px;text-align:center;font-size:11px;font-weight:700;border-radius:50%}
.dst-check-ico.ok{color:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-check-ico.warn{color:var(--dsw-alias-state-warn-primary,#f79009)}
.dst-check-ico.err{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-check-main{flex:1 1 auto;min-width:0}
.dst-check-msg{font-size:12.5px;color:var(--dsw-alias-label-primary,#191f28);word-break:break-word}
.dst-check-hint{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#637182);word-break:break-word}
.dst-check-cmd{margin-top:6px}
.dst-errline{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-error-primary,#f04438);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 25%,transparent);border-radius:var(--dsw-radius-md,10px);padding:7px 10px;word-break:break-word}
.dst-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-state-head{display:flex;align-items:center;gap:8px}
.dst-state-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28)}
.dst-state-actions{margin-top:12px;display:flex;gap:8px}
.dst-copied{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
@media (prefers-reduced-motion:reduce){.dst-switch,.dst-knob{transition:none}}
.dst-hbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#637182);cursor:pointer;flex:none}
.dst-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dst-hbtn:focus-visible{outline:2px solid var(--dsw-alias-state-focused-primary,#2e90fa);outline-offset:1px}
.dst-hbtn svg{display:block}
.dst-hbtn-dot{position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dsw-alias-bg-layer-1,#fff);background:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-hbtn-dot.on{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-hbtn-dot.off{background:var(--dsw-alias-state-error-primary,#f04438)}
.dst-hbtn-dot.warn{background:var(--dsw-alias-state-warn-primary,#f79009)}
.dst-nav-tailscale>svg:not(.dst-nav-mark){display:none}
.dst-nav-tailscale>.dst-nav-mark{flex:none}
.dst-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.dst-row .dst-btn{margin-left:0}
.dst-btn-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
.dst-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#3d5ce0)}
.dst-btn-primary:disabled{opacity:.55;cursor:default}
.dst-label{display:block;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#637182);margin-bottom:6px}
.dst-okline{margin-top:8px;font-size:12px;color:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-ver{margin-left:8px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#98a2b3);vertical-align:middle}
.dst-warnline{margin-top:8px;font-size:12px;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#b45309))}
.dst-card-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f79009) 45%,var(--dsw-alias-settings-card-stroke,#e3e7ed))}
.dst-log{margin-top:10px;max-height:150px;overflow:auto;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));border-radius:var(--dsw-radius-sm,8px);padding:8px 10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#637182)}
.dst-qr{margin-top:12px;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.dst-qr-img svg{display:block;background:#fff;border-radius:8px;padding:4px}
.dst-qr-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
`

    // ---------------------------------------------------------------- atoms
    function Dot({ tone }) {
      return h('span', { className: 'dst-dot ' + tone, 'aria-hidden': true })
    }

    function CopyField({ value, tr, ariaLabel, placeholder, mono }) {
      const inputRef = useRef(null)
      const timerRef = useRef(null)
      const [state, setState] = useState('')
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
      const flash = (s) => {
        setState(s)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; setState('') }, COPY_FLASH_MS)
      }
      const copy = async () => {
        const text = value || ''
        if (!text) return
        const ok = await writeClipboard(text)
        if (ok) flash('copied')
        else flash(selectNode(inputRef.current) ? 'select' : 'failed')
      }
      return h('div', { className: 'dst-field' },
        h('div', { className: 'dst-field-row' },
          h('input', {
            ref: inputRef,
            type: 'text',
            className: 'dst-input' + (mono ? ' dst-mono' : ''),
            readOnly: true,
            value: value || '',
            placeholder: placeholder || '',
            spellCheck: false,
            'aria-label': ariaLabel || tr('copy'),
            onFocus: (e) => { try { e.target.select() } catch (err) {} },
          }),
          h('button', { type: 'button', className: 'dst-btn', onClick: copy, disabled: !value },
            state === 'copied' ? tr('copied') : tr('copy'))),
        state === 'select' || state === 'failed' ? h('div', { className: 'dst-copied' }, tr('copySelect')) : null)
    }

    function CopyButton({ value, tr, label, fallbackRef }) {
      const timerRef = useRef(null)
      const [done, setDone] = useState(false)
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
      const onClick = async () => {
        const text = value || ''
        if (!text) return
        const ok = await writeClipboard(text)
        if (!ok && fallbackRef && fallbackRef.current) selectNode(fallbackRef.current)
        setDone(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; setDone(false) }, COPY_FLASH_MS)
      }
      return h('button', {
        type: 'button',
        className: 'dst-copy',
        title: label || tr('copy'),
        'aria-label': label || tr('copy'),
        onClick,
      }, done ? '✓' : '⧉')
    }

    function InlineError({ tr, err, onRetry }) {
      return h('div', { className: 'dst-errline' },
        h('span', { className: 'dst-grow' }, errorText(err, tr)),
        onRetry ? h('button', { type: 'button', className: 'dst-btn', onClick: onRetry }, tr('retry')) : null)
    }

    function StateCard({ tr, tone, title, hint, onRetry }) {
      return h('div', { className: 'dst-card dst-state dst-tone-' + tone },
        h('div', { className: 'dst-state-head' },
          h(Dot, { tone }),
          h('span', { className: 'dst-state-title' }, title)),
        hint ? h('div', { className: 'dst-mutedline' }, hint) : null,
        onRetry ? h('div', { className: 'dst-state-actions' },
          h('button', { type: 'button', className: 'dst-btn', onClick: onRetry }, tr('retry'))) : null)
    }

    // ---------------------------------------------------------------- 安装 / 登录 / 主机名
    function qrSvg(text, cellSize) {
      try {
        const qr = qrcode(0, 'M')
        qr.addData(String(text))
        qr.make()
        return qr.createSvgTag({ cellSize: cellSize || 3, margin: 2 })
      } catch (e) {
        return ''
      }
    }

    function QrBox({ tr, value, onHide }) {
      if (!value) return null
      const svg = qrSvg(value, 3)
      if (!svg) return h('div', { className: 'dst-mutedline' }, tr('qrFailed'))
      return h('div', { className: 'dst-qr' },
        h('div', { className: 'dst-qr-img', dangerouslySetInnerHTML: { __html: svg } }),
        h('div', { className: 'dst-qr-hint' }, tr('qrHint')),
        onHide ? h('button', { type: 'button', className: 'dst-btn', onClick: onHide }, tr('hideQr')) : null)
    }

    function SetupCard({ tr, setup, backend, busy, error, onInstall, onStart }) {
      const installed = !!(setup && setup.installed)
      const state = (setup && setup.state) || {}
      const running = !!state.running
      const logs = Array.isArray(state.log) ? state.log.slice(-6) : []
      const method = (setup && setup.method) || ''
      if (!installed) {
        return h('div', { className: 'dst-card dst-card-warn' },
          h('div', { className: 'dst-card-head' },
            h('span', { className: 'dst-card-title' }, tr('setupTitle')),
            h('span', { className: 'dst-grow' }),
            h('span', { className: 'dst-muted' }, tr('setupNotInstalled'))),
          h('div', { className: 'dst-mutedline' }, tr('installHint')),
          h('div', { className: 'dst-row' },
            h('button', {
              type: 'button',
              className: 'dst-btn dst-btn-primary',
              disabled: !!busy || running || !(setup && setup.allowAutoInstall),
              onClick: onInstall,
            }, running ? tr('installing') : tr('installButton')),
            method ? h('span', { className: 'dst-muted' }, tr('setupMethod', { method: method })) : null),
          !(setup && setup.allowAutoInstall) ? h('div', { className: 'dst-mutedline' }, tr('allowAutoOff')) : null,
          running || logs.length ? h('pre', { className: 'dst-log' }, logs.join('\n') || tr('installing')) : null,
          state.error ? h('div', { className: 'dst-mutedline' }, state.error.code + ': ' + state.error.message) : null,
          error ? h(InlineError, { tr, err: error }) : null)
      }
      if (backend === 'Running' || backend === 'NeedsLogin') return null
      return h('div', { className: 'dst-card dst-card-warn' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('setupTitle')),
          h('span', { className: 'dst-grow' }),
          h('span', { className: 'dst-muted' }, tr('setupInstalled'))),
        h('div', { className: 'dst-mutedline' }, tr('setupCli', { path: (setup && setup.cliPath) || '—' })),
        h('div', { className: 'dst-row' },
          h('button', { type: 'button', className: 'dst-btn', disabled: !!busy, onClick: onStart }, tr('startButton')),
          h('span', { className: 'dst-muted' }, tr('startHint'))),
        error ? h(InlineError, { tr, err: error }) : null)
    }

    function TailscaleLoginCard({ tr, needsLogin, authUrl, authBusy, authErr, onGetAuthUrl, onHideAuthUrl, authKey, onAuthKey, keyBusy, keyErr, onLoginKey, allowKey }) {
      if (!needsLogin) return null
      return h('div', { className: 'dst-card dst-card-warn' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('loginSection')),
          h('span', { className: 'dst-grow' })),
        h('div', { className: 'dst-mutedline' }, tr('loginHint')),
        h('div', { className: 'dst-row' },
          h('button', { type: 'button', className: 'dst-btn', disabled: !!authBusy, onClick: onGetAuthUrl }, authBusy ? tr('loading') : (authUrl ? tr('refresh') : tr('loginQr'))),
          authUrl ? h('a', { className: 'dst-btn', href: authUrl.url, target: '_blank', rel: 'noreferrer noopener' }, tr('openInBrowser')) : null),
        authUrl ? h(QrBox, { tr, value: authUrl.url, onHide: onHideAuthUrl }) : null,
        authErr ? h(InlineError, { tr, err: authErr }) : null,
        allowKey ? h('div', { className: 'dst-sep' }) : null,
        allowKey ? h('div', { className: 'dst-field' },
          h('label', { className: 'dst-label' }, tr('authKeyLabel')),
          h('input', {
            className: 'dst-input',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            value: authKey,
            placeholder: tr('authKeyPlaceholder'),
            onChange: (event) => onAuthKey(event.target.value),
          }),
          h('div', { className: 'dst-mutedline' }, tr('authKeyHint'))) : null,
        allowKey ? h('div', { className: 'dst-row' },
          h('button', {
            type: 'button',
            className: 'dst-btn dst-btn-primary',
            disabled: !!keyBusy || !String(authKey || '').trim(),
            onClick: onLoginKey,
          }, keyBusy ? tr('loginKeyBusy') : tr('loginWithKey'))) : null,
        keyErr ? h(InlineError, { tr, err: keyErr }) : null)
    }

    function HostnameCard({ tr, current, value, onChange, onSave, busy, error, saved }) {
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('hostnameTitle')),
          h('span', { className: 'dst-grow' }),
          h('span', { className: 'dst-muted' }, current || '—')),
        h('div', { className: 'dst-mutedline' }, tr('hostnameHint')),
        h('div', { className: 'dst-row' },
          h('input', {
            className: 'dst-input',
            value: value,
            placeholder: current || 'dsh-host',
            spellCheck: false,
            onChange: (event) => onChange(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'dst-btn',
            disabled: !!busy || !String(value || '').trim() || String(value || '').trim() === current,
            onClick: onSave,
          }, busy ? tr('saving') : tr('hostnameSave'))),
        h('div', { className: 'dst-mutedline' }, tr('hostnameImpact')),
        error ? h(InlineError, { tr, err: error }) : null,
        saved ? h('div', { className: 'dst-okline' }, tr('hostnameSaved')) : null)
    }

    function UpdateCard({ tr, info, busy, onCheck, onClose }) {
      const available = !!(info && info.updateAvailable)
      const statusText = !info
        ? ''
        : info.error
          ? tr('updateCheckFailed', { msg: info.error })
          : available
            ? tr('updateAvailable', { latest: info.latest })
            : tr('upToDate', { version: info.current })
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('updateTitle')),
          h('span', { className: 'dst-grow' }),
          h('button', { type: 'button', className: 'dst-btn', onClick: onClose }, tr('close'))),
        h('div', { className: 'dst-mutedline' }, tr('updateNote')),
        h('div', { className: 'dst-row' },
          h('span', null, tr('currentVersion') + ' v' + ((info && info.current) || '—')),
          h('span', { className: 'dst-muted' }, '·'),
          h('span', null, tr('latestVersion') + ' ' + (info && info.latest ? 'v' + info.latest : '—'))),
        h('div', { className: available || (info && info.error) ? 'dst-warnline' : 'dst-okline' }, statusText),
        available && info.command ? h(CopyField, { value: info.command, tr, ariaLabel: tr('updateCommand'), mono: true }) : null,
        h('div', { className: 'dst-row' },
          h('button', { type: 'button', className: 'dst-btn', disabled: !!busy, onClick: onCheck }, busy ? tr('checkingUpdate') : tr('retryCheck'))))
    }

    // ---------------------------------------------------------------- 状态卡
    function StatusCard({ snap, tr, entryBusy, entryErr, onToggle }) {
      const st = statusInfo(snap)
      const status = (snap && snap.status) || {}
      const pub = (snap && snap.publication) || {}
      const enabled = !!pub.enabled
      const dns = status.dnsName || (status.self && status.self.dnsName) || ''
      const related = st.checkId ? checkById(checksOf(snap), st.checkId) : null
      const command = related && related.command ? related.command : ''
      return h('div', { className: 'dst-card dst-status dst-tone-' + st.tone },
        h('div', { className: 'dst-status-head' },
          h(Dot, { tone: st.tone }),
          h('span', { className: 'dst-status-label' }, tr(st.key)),
          h('span', { className: 'dst-grow' }),
          h('span', { className: 'dst-muted' }, entryBusy ? tr('entryWorking') : enabled ? tr('entryOn') : tr('entryOff')),
          h('button', {
            type: 'button',
            role: 'switch',
            className: 'dst-switch',
            'aria-checked': enabled ? 'true' : 'false',
            'aria-label': tr('entryLabel'),
            disabled: !!entryBusy,
            onClick: onToggle,
          }, h('span', { className: 'dst-knob' }))),
        h('div', { className: 'dst-meta' },
          h('span', { className: 'dst-mono' }, dns || tr('valueNone')),
          status.backend ? h('span', null, tr('backendLabel') + ' ' + status.backend) : null,
          status.version ? h('span', null, 'v' + status.version) : null),
        st.hintKey ? h('div', { className: 'dst-hintline ' + st.tone }, tr(st.hintKey)) : null,
        command ? h(CopyField, { value: command, tr, ariaLabel: tr('copyCommand'), mono: true }) : null,
        entryErr ? h(InlineError, { tr, err: entryErr }) : null)
    }

    // ---------------------------------------------------------------- 入口卡
    function EntryCard({ snap, tr, login, loginRemain, loginBusy, loginErr, onGenerate }) {
      const [qr, setQr] = useState('')
      const pub = (snap && snap.publication) || {}
      const cfg = (snap && snap.config) || {}
      const enabled = !!pub.enabled
      // 入口关闭时 Host 也会返回“将要使用”的 URL；这里只在已开启时展示，避免误以为入口已生效。
      const url = enabled && typeof pub.url === 'string' ? pub.url : ''
      const target = typeof pub.target === 'string' ? pub.target : ''
      const port = cfg.httpsPort
      const route = target ? (port ? String(port) + ' → ' + target : target) : ''
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('entrySection'))),
        enabled ? null : h('div', { className: 'dst-mutedline' }, tr('entryOffHint')),
        h(CopyField, { value: url, tr, ariaLabel: tr('urlLabel'), placeholder: tr('valueNone'), mono: true }),
        enabled && url ? h('div', { className: 'dst-row' },
          h('button', {
            type: 'button',
            className: 'dst-btn',
            onClick: () => setQr(qr === 'entry' ? '' : 'entry'),
          }, qr === 'entry' ? tr('hideQr') : tr('showEntryQr')),
          qr === 'entry' ? h('a', { className: 'dst-btn', href: url, target: '_blank', rel: 'noreferrer noopener' }, tr('openInBrowser')) : null) : null,
        qr === 'entry' && url ? h(QrBox, { tr, value: url, onHide: () => setQr('') }) : null,
        route ? h('div', { className: 'dst-meta' }, h('span', null, tr('targetLabel') + ' ' + route)) : null,
        pub.adopted ? h('div', { className: 'dst-mutedline' }, tr('adoptedNote')) : null,
        h('div', { className: 'dst-login' },
          h('div', { className: 'dst-login-head' },
            h('span', { className: 'dst-card-title' }, tr('loginTitle')),
            h('button', {
              type: 'button',
              className: 'dst-btn primary',
              disabled: !!loginBusy || !enabled,
              onClick: onGenerate,
            }, loginBusy ? tr('generating') : tr('generateLogin'))),
          h('div', { className: 'dst-notice' }, tr('loginNotice')),
          loginErr ? h(InlineError, { tr, err: loginErr }) : null,
          login && login.url ? h('div', { className: 'dst-login-url' },
            h(CopyField, { value: login.url, tr, ariaLabel: tr('loginUrlLabel'), mono: true }),
            h('div', { className: 'dst-copied' }, tr('loginHideIn', { n: loginRemain })),
            h('div', { className: 'dst-row' },
              h('button', {
                type: 'button',
                className: 'dst-btn',
                onClick: () => setQr(qr === 'login' ? '' : 'login'),
              }, qr === 'login' ? tr('hideQr') : tr('showLoginQr'))),
            qr === 'login' ? h(QrBox, { tr, value: login.url, onHide: () => setQr('') }) : null) : null))
    }

    // ---------------------------------------------------------------- 设备卡
    function DeviceRow({ d, tr }) {
      const domainRef = useRef(null)
      const online = !!d.online
      const dns = typeof d.dnsName === 'string' ? d.dnsName : ''
      const ips = Array.isArray(d.ips) ? d.ips : []
      const tags = Array.isArray(d.tags) ? d.tags : []
      const host = d.hostName || dns || tr('unknownDevice')
      const seen = !online && d.lastSeen ? relText(d.lastSeen, tr) : ''
      const meta = []
      if (dns) meta.push(h('span', { key: 'dns', ref: domainRef, className: 'dst-mono dst-dev-domain', title: dns }, dns))
      if (ips[0]) meta.push(h('span', { key: 'ip', className: 'dst-mono' }, ips[0]))
      if (d.os) meta.push(h('span', { key: 'os' }, d.os))
      if (tags.length) meta.push(h('span', { key: 'tags', className: 'dst-tags' }, tags.map((tag, i) => h('span', { key: i, className: 'dst-tag' }, tag))))
      if (seen) meta.push(h('span', { key: 'seen' }, tr('lastSeen', { t: seen })))
      const metaNodes = []
      meta.forEach((node, i) => {
        if (i) metaNodes.push(h('span', { key: 'sep' + i, className: 'dst-sep', 'aria-hidden': true }, '·'))
        metaNodes.push(node)
      })
      return h('div', { className: 'dst-dev' },
        h(Dot, { tone: online ? 'ok' : 'idle' }),
        h('div', { className: 'dst-dev-main' },
          h('div', { className: 'dst-dev-top' },
            h('span', { className: 'dst-dev-name' }, host),
            d.isSelf ? h('span', { className: 'dst-badge' }, tr('selfBadge')) : null,
            online ? null : h('span', { className: 'dst-dev-off' }, tr('offline'))),
          metaNodes.length ? h('div', { className: 'dst-dev-meta' }, metaNodes) : null),
        dns ? h('span', { className: 'dst-dev-actions' },
          h(CopyButton, { value: dns, tr, label: tr('copyDomain'), fallbackRef: domainRef })) : null)
    }

    function DevicesCard({ devices, tr, busy, error, onRefresh }) {
      const list = Array.isArray(devices) ? devices.filter((d) => d && typeof d === 'object') : []
      const sorted = sortDevices(list)
      const online = list.filter((d) => d.online).length
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('devicesTitle')),
          h('span', { className: 'dst-card-sub' }, tr('deviceSummary', { online, total: list.length })),
          h('div', { className: 'dst-card-actions' },
            h('button', { type: 'button', className: 'dst-btn', onClick: onRefresh, disabled: !!busy },
              busy ? tr('refreshing') : tr('refreshDevices')))),
        error ? h(InlineError, { tr, err: error, onRetry: onRefresh }) : null,
        sorted.length === 0
          ? h('div', { className: 'dst-empty' }, tr('devicesEmpty'))
          : h('div', { className: 'dst-list' },
            sorted.map((d, i) => h(DeviceRow, { key: d.id || d.dnsName || d.hostName || 'dev' + i, d, tr }))))
    }

    // ---------------------------------------------------------------- 诊断卡
    function CheckRow({ c, tr }) {
      const tone = c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : 'ok'
      const ico = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '✕'
      return h('div', { className: 'dst-check' },
        h('span', { className: 'dst-check-ico ' + tone, 'aria-hidden': true }, ico),
        h('div', { className: 'dst-check-main' },
          h('div', { className: 'dst-check-msg' }, c.message || c.id || tr('unknownError')),
          c.hint ? h('div', { className: 'dst-check-hint' }, '↳ ' + c.hint) : null,
          c.command ? h('div', { className: 'dst-check-cmd' },
            h(CopyField, { value: c.command, tr, ariaLabel: tr('copyCommand'), mono: true })) : null))
    }

    function DiagnosticsCard({ health, tr, busy, error, onRecheck }) {
      const checks = health && Array.isArray(health.checks) ? health.checks : []
      const failing = checks.filter((c) => c.ok === false || c.level === 'warn' || c.level === 'error').length
      let summary = ''
      if (health) summary = health.ok && failing === 0 ? tr('healthOk') : tr('healthIssues', { n: failing })
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('diagTitle')),
          summary ? h('span', { className: 'dst-card-sub' }, summary) : null,
          h('div', { className: 'dst-card-actions' },
            h('button', { type: 'button', className: 'dst-btn', onClick: onRecheck, disabled: !!busy },
              busy ? tr('checking') : tr('recheck')))),
        error ? h(InlineError, { tr, err: error, onRetry: onRecheck }) : null,
        checks.length === 0
          ? h('div', { className: 'dst-empty' }, tr('diagEmpty'))
          : h('div', { className: 'dst-checks' },
            checks.map((c, i) => h(CheckRow, { key: (c.id || 'check') + i, c, tr }))))
    }

    // ---------------------------------------------------------------- 设置页整节
    function Section(props) {
      useLocaleTick()
      const tr = trWith(props && props.t)
      const [snap, setSnap] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [loadErr, setLoadErr] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [entryBusy, setEntryBusy] = useState(false)
      const [entryErr, setEntryErr] = useState(null)
      const [devicesBusy, setDevicesBusy] = useState(false)
      const [devicesErr, setDevicesErr] = useState(null)
      const [healthBusy, setHealthBusy] = useState(false)
      const [healthErr, setHealthErr] = useState(null)
      const [login, setLogin] = useState(null)
      const [loginRemain, setLoginRemain] = useState(0)
      const [loginBusy, setLoginBusy] = useState(false)
      const [loginErr, setLoginErr] = useState(null)
      const [setupBusy, setSetupBusy] = useState(false)
      const [setupErr, setSetupErr] = useState(null)
      const [authUrl, setAuthUrl] = useState(null)
      const [authBusy, setAuthBusy] = useState(false)
      const [authErr, setAuthErr] = useState(null)
      const [authKey, setAuthKey] = useState('')
      const [keyBusy, setKeyBusy] = useState(false)
      const [keyErr, setKeyErr] = useState(null)
      const [hostValue, setHostValue] = useState('')
      const [hostBusy, setHostBusy] = useState(false)
      const [hostErr, setHostErr] = useState(null)
      const [hostSaved, setHostSaved] = useState(false)
      const [updateInfo, setUpdateInfo] = useState(null)
      const [updateBusy, setUpdateBusy] = useState(false)
      const [updateOpen, setUpdateOpen] = useState(false)
      const aliveRef = useRef(true)
      const snapRef = useRef(null)
      const reqRef = useRef(0)

      const commitSnap = (next) => {
        snapRef.current = next
        setSnap(next)
      }

      // 首屏一次 snapshot；focus / visibilitychange 再刷新一次；无常驻定时器。
      const load = useCallback(async (opts) => {
        const force = !!(opts && opts.force)
        const silent = !!(opts && opts.silent)
        const seq = ++reqRef.current
        if (!silent) setRefreshing(true)
        try {
          const value = await api.snapshot(force ? { fresh: true } : {})
          if (!aliveRef.current || seq !== reqRef.current) return
          commitSnap(normSnapshot(value))
          setLoadErr(null)
          setPhase('ready')
        } catch (e) {
          if (!aliveRef.current || seq !== reqRef.current) return
          const kind = e && e.kind ? e.kind : 'unknown'
          if (kind === 'unauthorized') {
            setLoadErr(e)
            setPhase('unauthorized')
            return
          }
          if (kind === 'unavailable') {
            setLoadErr(e)
            setPhase('unavailable')
            return
          }
          setLoadErr(e)
          if (!snapRef.current) setPhase('error')
        } finally {
          if (aliveRef.current && seq === reqRef.current && !silent) setRefreshing(false)
        }
      }, [])

      useEffect(() => {
        aliveRef.current = true
        load()
        const onRefresh = () => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          load({ silent: true, force: true })
        }
        window.addEventListener('focus', onRefresh)
        document.addEventListener('visibilitychange', onRefresh)
        return () => {
          aliveRef.current = false
          window.removeEventListener('focus', onRefresh)
          document.removeEventListener('visibilitychange', onRefresh)
        }
      }, [load])

      // 登录链接 60s 自动隐藏（只在这个链接存在时跑一个 1s 定时器）
      useEffect(() => {
        if (!login) return undefined
        let alive = true
        const tick = () => {
          if (!alive) return
          const left = Math.max(0, Math.ceil((login.expiresAt - Date.now()) / 1000))
          setLoginRemain(left)
          if (left <= 0) setLogin(null)
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [login])

      // 入口被外部关掉时，丢弃已经生成的链接（token 不留在内存里）
      useEffect(() => {
        if (snap && !snap.publication.enabled && login) setLogin(null)
      }, [snap, login])

      const toggleEntry = useCallback(async () => {
        const cur = snapRef.current
        if (!cur || entryBusy) return
        const next = !cur.publication.enabled
        setEntryBusy(true)
        setEntryErr(null)
        try {
          const value = next ? await api.publish({}) : await api.unpublish()
          if (!aliveRef.current) return
          const publication = value && typeof value === 'object'
            ? normPublication(value)
            : { ...cur.publication, enabled: next, url: next ? cur.publication.url : '' }
          setLogin(null)
          setLoginErr(null)
          commitSnap({ ...cur, publication })
          load({ silent: true, force: true })
        } catch (e) {
          if (!aliveRef.current) return
          setEntryErr(e)
        } finally {
          if (aliveRef.current) setEntryBusy(false)
        }
      }, [entryBusy, load])

      const refreshDevices = useCallback(async () => {
        setDevicesBusy(true)
        setDevicesErr(null)
        try {
          const value = await api.devices({ fresh: true })
          if (!aliveRef.current) return
          const raw = Array.isArray(value) ? value : value && Array.isArray(value.devices) ? value.devices : []
          const cur = snapRef.current
          if (cur) commitSnap({ ...cur, devices: raw.map(normDevice) })
        } catch (e) {
          if (!aliveRef.current) return
          setDevicesErr(e)
        } finally {
          if (aliveRef.current) setDevicesBusy(false)
        }
      }, [])

      const recheckHealth = useCallback(async () => {
        setHealthBusy(true)
        setHealthErr(null)
        try {
          // deep 检查会额外发 https HEAD（5s）+ 本机 /api 请求（3s），叠加 CLI 调用可能超过 8s 的客户端超时；
          // 设置页的「重新检查」用浅检（cli/backend/dnsName/route/trust/funnel），深检留给需要时单独调用。
          const value = await api.health({ deep: false })
          if (!aliveRef.current) return
          const cur = snapRef.current
          if (cur) commitSnap({ ...cur, health: normHealth(value) })
        } catch (e) {
          if (!aliveRef.current) return
          setHealthErr(e)
        } finally {
          if (aliveRef.current) setHealthBusy(false)
        }
      }, [])

      const generateLogin = useCallback(async () => {
        if (loginBusy) return
        setLoginBusy(true)
        setLoginErr(null)
        try {
          const value = await api.loginUrl()
          if (!aliveRef.current) return
          const url = value && typeof value.url === 'string' ? value.url : typeof value === 'string' ? value : ''
          if (!url) throw rpcErr('rpc', '', 'empty login url', 0)
          setLogin({ url, expiresAt: Date.now() + LOGIN_TTL_MS })
          setLoginRemain(Math.round(LOGIN_TTL_MS / 1000))
        } catch (e) {
          if (!aliveRef.current) return
          setLoginErr(e)
        } finally {
          if (aliveRef.current) setLoginBusy(false)
        }
      }, [loginBusy])

      // Tailscale 登录二维码 60s 自动隐藏；登录成功后立即丢弃
      useEffect(() => {
        if (!authUrl) return undefined
        let alive = true
        const tick = () => {
          if (!alive) return
          if (Date.now() >= authUrl.expiresAt) setAuthUrl(null)
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [authUrl])

      useEffect(() => {
        if (snap && snap.status.backend === 'Running' && authUrl) setAuthUrl(null)
      }, [snap, authUrl])

      // hostname 初始值跟随快照（用户改过就保留输入）
      useEffect(() => {
        const current = snap && snap.status.self.hostName
        if (current) setHostValue((prev) => (prev ? prev : current))
      }, [snap])

      // 安装进行中：2s 轮询状态机（结束后自动停）
      const setupRunning = !!(snap && snap.setup && snap.setup.state && snap.setup.state.running)
      useEffect(() => {
        if (!setupRunning) return undefined
        const id = setInterval(() => load({ silent: true, force: true }), 2000)
        return () => clearInterval(id)
      }, [setupRunning, load])

      useEffect(() => {
        let alive = true
        api.updateCheck(false).then((value) => {
          if (alive) setUpdateInfo(value || null)
        }).catch(() => {})
        return () => { alive = false }
      }, [])

      const runUpdateCheck = async () => {
        if (updateBusy) return
        setUpdateBusy(true)
        try {
          const value = await api.updateCheck(true)
          if (!aliveRef.current) return
          setUpdateInfo(value || null)
          setUpdateOpen(true)
        } catch (e) {
          if (!aliveRef.current) return
          setUpdateInfo({ current: '—', latest: null, updateAvailable: false, command: '', error: String((e && e.message) || e) })
          setUpdateOpen(true)
        } finally {
          if (aliveRef.current) setUpdateBusy(false)
        }
      }

      const doInstall = async () => {
        if (setupBusy) return
        setSetupBusy(true)
        setSetupErr(null)
        try {
          await api.install()
          if (!aliveRef.current) return
          await load({ silent: true, force: true })
        } catch (e) {
          if (aliveRef.current) setSetupErr(e)
        } finally {
          if (aliveRef.current) setSetupBusy(false)
        }
      }

      const doStart = async () => {
        if (setupBusy) return
        setSetupBusy(true)
        setSetupErr(null)
        try {
          await api.start()
          if (!aliveRef.current) return
          await new Promise((resolve) => setTimeout(resolve, 1500))
          await load({ silent: true, force: true })
        } catch (e) {
          if (aliveRef.current) setSetupErr(e)
        } finally {
          if (aliveRef.current) setSetupBusy(false)
        }
      }

      const getAuthUrl = async () => {
        if (authBusy) return
        setAuthBusy(true)
        setAuthErr(null)
        try {
          const value = await api.authUrl()
          if (!aliveRef.current) return
          const url = value && typeof value.url === 'string' ? value.url : typeof value === 'string' ? value : ''
          if (!url) throw rpcErr('rpc', '', 'empty auth url', 0)
          setAuthUrl({ url: url, expiresAt: Date.now() + LOGIN_TTL_MS })
        } catch (e) {
          if (aliveRef.current) setAuthErr(e)
        } finally {
          if (aliveRef.current) setAuthBusy(false)
        }
      }

      const hideAuthUrl = () => setAuthUrl(null)

      const doLoginKey = async () => {
        const key = String(authKey || '').trim()
        if (!key || keyBusy) return
        setKeyBusy(true)
        setKeyErr(null)
        try {
          await api.login({ key: key, hostname: String(hostValue || '').trim() || undefined })
          if (!aliveRef.current) return
          setAuthUrl(null)
          await load({ silent: true, force: true })
        } catch (e) {
          if (aliveRef.current) setKeyErr(e)
        } finally {
          if (aliveRef.current) {
            setKeyBusy(false)
            setAuthKey('')
          }
        }
      }

      const saveHostname = async () => {
        const next = String(hostValue || '').trim()
        const current = (snapRef.current && snapRef.current.status.self.hostName) || ''
        if (!next || next === current || hostBusy) return
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(tr('hostnameConfirm', { name: next }))
          : true
        if (!confirmed) return
        setHostBusy(true)
        setHostErr(null)
        setHostSaved(false)
        try {
          await api.setHostname({ hostname: next })
          if (!aliveRef.current) return
          setHostSaved(true)
          await load({ silent: true, force: true })
        } catch (e) {
          if (aliveRef.current) setHostErr(e)
        } finally {
          if (aliveRef.current) setHostBusy(false)
        }
      }

      const view = snap || EMPTY_SNAPSHOT
      const head = h('div', { className: 'dst-shead' },
        h('div', { className: 'dst-shead-main' },
          h('h2', { className: 'dst-title' }, tr('title'),
            h('span', { className: 'dst-ver' }, 'v' + ((updateInfo && updateInfo.current) || '—'))),
          h('div', { className: 'dst-desc' }, tr('desc'))),
        h('div', { className: 'dst-shead-actions' },
          h('button', { type: 'button', className: 'dst-btn', disabled: updateBusy, onClick: runUpdateCheck },
            updateBusy ? tr('checkingUpdate') : tr('checkUpdate')),
          h('button', { type: 'button', className: 'dst-btn', onClick: () => load({ force: true }), disabled: refreshing },
            refreshing ? tr('refreshing') : '↻ ' + tr('refresh'))))

      let body = null
      if (phase === 'loading' && !snap) {
        body = h('div', { className: 'dst-card dst-empty' }, tr('loading'))
      } else if (phase === 'unauthorized') {
        body = h(StateCard, { tr, tone: 'warn', title: tr('unauthorized'), hint: tr('unauthorizedHint') })
      } else if (phase === 'unavailable') {
        body = h(StateCard, {
          tr, tone: 'warn', title: tr('hostUnavailable'), hint: tr('hostUnavailableHint'),
          onRetry: () => load({ force: true }),
        })
      } else if (phase === 'error' && !snap) {
        const known = statusFromErrorCode(loadErr)
        body = known
          ? h(StateCard, {
            tr, tone: 'err', title: tr(known.key), hint: tr(known.hintKey),
            onRetry: () => load({ force: true }),
          })
          : h(StateCard, {
            tr, tone: 'err', title: tr('loadFailed'), hint: errorText(loadErr, tr),
            onRetry: () => load({ force: true }),
          })
      } else {
        body = h('div', { className: 'dst-body' },
          loadErr ? h(InlineError, { tr, err: loadErr, onRetry: () => load({ force: true }) }) : null,
          updateOpen && updateInfo ? h(UpdateCard, {
            tr, info: updateInfo, busy: updateBusy, onCheck: runUpdateCheck, onClose: () => setUpdateOpen(false),
          }) : null,
          h(SetupCard, {
            tr, setup: view.setup, backend: view.status.backend,
            busy: setupBusy, error: setupErr, onInstall: doInstall, onStart: doStart,
          }),
          h(TailscaleLoginCard, {
            tr, needsLogin: view.status.needsLogin,
            authUrl, authBusy, authErr, onGetAuthUrl: getAuthUrl, onHideAuthUrl: hideAuthUrl,
            authKey, onAuthKey: setAuthKey, keyBusy, keyErr, onLoginKey: doLoginKey, allowKey: true,
          }),
          h(StatusCard, { snap: view, tr, entryBusy, entryErr, onToggle: toggleEntry }),
          h(EntryCard, { snap: view, tr, login, loginRemain, loginBusy, loginErr, onGenerate: generateLogin }),
          h(HostnameCard, {
            tr, current: view.status.self.hostName, value: hostValue, onChange: setHostValue,
            onSave: saveHostname, busy: hostBusy, error: hostErr, saved: hostSaved,
          }),
          h(DevicesCard, { devices: view.devices, tr, busy: devicesBusy, error: devicesErr, onRefresh: refreshDevices }),
          h(DiagnosticsCard, { health: view.health, tr, busy: healthBusy, error: healthErr, onRecheck: recheckHealth }))
      }

      return h('div', { className: 'dst-root' }, head, body)
    }

    // ---------------------------------------------------------------- 顶部图标（在线/离线 + 打开设置）
    function snapshotValue(observable) {
      if (!observable) return null
      try {
        if (typeof observable.get === 'function') return observable.get()
        if (typeof observable.getSnapshot === 'function') return observable.getSnapshot()
        if (typeof observable === 'object' && 'value' in observable) return observable.value
      } catch (e) {}
      return null
    }

    function settingsCommandRow(ctx) {
      try {
        const service = ctx.get('shortcuts')
        const rows = snapshotValue(service && service.catalog)
        if (Array.isArray(rows)) return rows.find((row) => row && row.id === 'settings.open') || null
      } catch (e) {}
      return null
    }

    function findButtonByText(text) {
      if (!text || typeof document === 'undefined') return null
      const nodes = document.querySelectorAll('button')
      for (const node of nodes) if ((node.textContent || '').trim() === text) return node
      return null
    }

    function findButtonByLabel(label) {
      if (!label || typeof document === 'undefined') return null
      const nodes = document.querySelectorAll('button,[role="button"]')
      for (const node of nodes) {
        const aria = node.getAttribute('aria-label') || ''
        const title = node.getAttribute('title') || ''
        if (aria === label || title === label) return node
      }
      return null
    }

    // 打开「设置 → 远程访问」：先点已有导航项；否则用 settings.open 快捷键（web: primary+alt+Comma）
    // 打开设置面板，再等它渲染出我们的分区并点中。没有公开的 settings 导航服务，只能这样无缝衔接。
    function openSettingsSection(ctx) {
      const label = (() => {
        try { return ctx.locale.bind(NS)('title') } catch (e) { return zh.title }
      })()
      const clickNav = () => {
        const node = findButtonByText(label)
        if (!node) return false
        try { node.click() } catch (e) { return false }
        return true
      }
      if (clickNav()) return
      const isMac = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '')
      const row = settingsCommandRow(ctx)
      const triggerLabels = []
      if (row && typeof row.label === 'string' && row.label) triggerLabels.push(row.label)
      triggerLabels.push('Settings', '设置', 'Preferences', '偏好设置')
      const init = { code: 'Comma', key: ',', bubbles: true, cancelable: true, composed: true, altKey: true, metaKey: isMac, ctrlKey: !isMac }
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', init))
        window.dispatchEvent(new KeyboardEvent('keyup', init))
      } catch (e) {}
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        if (clickNav()) { clearInterval(timer); return }
        if (attempts === 4) {
          for (const text of triggerLabels) {
            const trigger = findButtonByLabel(text)
            if (trigger) { try { trigger.click() } catch (e) {}; break }
          }
        }
        if (attempts >= 20) clearInterval(timer)
      }, 100)
    }

    function tailscaleGlyph() {
      // 官方 mark：深色圆角方块 + 3×3 九点（比“六个点”更容易认出是 Tailscale）。
      const dots = []
      for (const cy of [15, 24, 33]) {
        for (const cx of [15, 24, 33]) {
          dots.push(h('circle', { key: cx + ':' + cy, cx: cx, cy: cy, r: 3.8, fill: 'var(--dsw-alias-bg-base,#fff)' }))
        }
      }
      // 固定品牌配色：浅色主题近黑底白点，深色主题近白底黑点；不跟随按钮的“次要灰”，避免未选中时发灰。
      return h('svg', { width: 18, height: 18, viewBox: '0 0 48 48', 'aria-hidden': 'true' },
        h('rect', { x: 0, y: 0, width: 48, height: 48, rx: 12, fill: 'var(--dsw-alias-label-primary,#191f28)' }),
        dots)
    }

    function TailscaleHeaderButton(props) {
      const { t, openSettings } = props || {}
      const tr = trWith(t)
      const [summary, setSummary] = useState(null)
      const [failed, setFailed] = useState(false)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      const load = useCallback(() => {
        api.status().then((value) => {
          if (!alive.current) return
          setSummary(value || null)
          setFailed(false)
        }).catch(() => {
          if (alive.current) setFailed(true)
        })
      }, [])
      useEffect(() => {
        load()
        const id = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load()
        }, 30000)
        const onVisible = () => { if (document.visibilityState === 'visible') load() }
        const onFocus = () => load()
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onFocus)
        return () => {
          clearInterval(id)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onFocus)
        }
      }, [load])
      const running = !!(summary && summary.running)
      const dotClass = summary ? (running ? 'on' : 'off') : failed ? 'warn' : ''
      const bits = [tr('headerTitle')]
      if (summary) {
        bits.push(running ? tr('headerOnline') : tr('headerOffline'))
        if (summary.dnsName) bits.push(summary.dnsName)
        if (summary.publication) bits.push(summary.publication.enabled ? tr('headerEntryOn') : tr('headerEntryOff'))
        if (summary.devicesTotal != null) bits.push(tr('headerDeviceCount', { online: summary.devicesOnline || 0, total: summary.devicesTotal || 0 }))
      } else if (failed) {
        bits.push(tr('headerUnknown'))
      }
      const title = bits.filter(Boolean).join(' · ')
      return h('button', {
        type: 'button',
        className: 'dst-hbtn',
        title: title,
        'aria-label': title,
        onClick: () => { if (typeof openSettings === 'function') openSettings() },
      }, tailscaleGlyph(), h('span', { className: 'dst-hbtn-dot ' + dotClass, 'aria-hidden': true }))
    }

    // ---------------------------------------------------------------- apply
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tailscale: locale')
        ctx.effect(() => {
          let off = null
          try {
            if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
              off = ctx.locale.subscribe(() => {
                for (const fn of Array.from(LOCALE_TICK.subs)) {
                  try { fn() } catch (e) {}
                }
              })
            }
          } catch (e) {}
          return () => { if (off) { try { off() } catch (e) {} } }
        }, 'dsh-tailscale: locale-change')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.id = 'dsh-tailscale-style'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-tailscale: styles')

        // DSH 的设置导航图标按 section id 硬编码、没有插件图标字段。
        // 这里给“文案等于 Tailscale”的那一行注入我们的 mark（真实 DOM SVG，用主题 token 上色），
        // 并隐藏默认齿轮；React 重渲染时由 MutationObserver 补回，失败时退回默认图标，不影响功能。
        ctx.effect(() => {
          if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined
          const SVG_NS = 'http://www.w3.org/2000/svg'
          const buildMark = () => {
            const svg = document.createElementNS(SVG_NS, 'svg')
            svg.setAttribute('width', '16')
            svg.setAttribute('height', '16')
            svg.setAttribute('viewBox', '0 0 48 48')
            svg.setAttribute('aria-hidden', 'true')
            svg.setAttribute('class', 'dst-nav-mark')
            const rect = document.createElementNS(SVG_NS, 'rect')
            rect.setAttribute('width', '48')
            rect.setAttribute('height', '48')
            rect.setAttribute('rx', '12')
            rect.setAttribute('fill', 'var(--dsw-alias-label-primary,#191f28)')
            svg.appendChild(rect)
            for (const cy of [15, 24, 33]) {
              for (const cx of [15, 24, 33]) {
                const dot = document.createElementNS(SVG_NS, 'circle')
                dot.setAttribute('cx', String(cx))
                dot.setAttribute('cy', String(cy))
                dot.setAttribute('r', '3.8')
                dot.setAttribute('fill', 'var(--dsw-alias-bg-base,#fff)')
                svg.appendChild(dot)
              }
            }
            return svg
          }
          const mark = () => {
            const nodes = document.querySelectorAll('button')
            for (const node of nodes) {
              if ((node.textContent || '').trim() !== 'Tailscale') continue
              if (!node.querySelector('svg')) continue
              if (!node.classList.contains('dst-nav-tailscale')) node.classList.add('dst-nav-tailscale')
              if (!node.querySelector('.dst-nav-mark')) node.insertBefore(buildMark(), node.firstChild)
            }
          }
          mark()
          const observer = new MutationObserver(() => mark())
          observer.observe(document.body, { childList: true, subtree: true })
          return () => observer.disconnect()
        }, 'dsh-tailscale: settings nav mark')

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'tailscale',
          order: 40,
          label: () => { try { return ctx.locale.bind(NS)('title') } catch (e) { return zh.title } },
          locale: NS,
          inject: () => ({}),
        }, Section))

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'dsh-tailscale',
          order: 9,
          locale: NS,
          inject: () => ({ openSettings: () => openSettingsSection(ctx) }),
        }, TailscaleHeaderButton))
      },
    }
  },
})

import {aesWasm} from './aes_bg';
import {WordArray} from '../core/core';
import {BlockCipher} from '../core/cipher-core.js';
import {loadWasm} from '../utils/wasm-utils';
import {wasmBytes} from './aes_wasm';
import pako from 'pako';
import fs from 'fs';

/**
 * AES block cipher algorithm.
 */
export class AESAlgo extends BlockCipher {
  static get keySize() {
    return 256 / 32;
  }

  static wasm = null;

  constructor(...args) {
    super(...args);

    this.keySize = 256 / 32;
  }

  static async loadWasm() {
    let file = fs.readFileSync('/home/peterlee/code/wasm_benchmark_rust_repos/WASM-benchmark-rust-repos/pkg/sha3_bg.wasm');
    let array = new Uint8Array(file);
    let compressed = pako.deflate(array);
    let result = Buffer.from(compressed).toString('base64');

    console.log(result);
    if (AESAlgo.wasm) {
      return AESAlgo.wasm;
    }

    AESAlgo.wasm = await loadWasm(wasmBytes);
    return AESAlgo.wasm;
  }

  async loadWasm() {
    return AESAlgo.loadWasm();
  }

  _doReset() {
    // Skip reset of nRounds has been set before and key did not change
    if (this._nRounds && this._keyPriorReset === this._key) {
      return;
    }

    // Shortcuts
    const key = this._key;
    const keyWords = key.words;
    const keySize = key.sigBytes / 4;

    // Compute number of rounds
    this._nRounds = keySize + 6;

    this._keySchedule = aesWasm(AESAlgo.wasm).getKeySchedule(keySize, keyWords);
    this._invKeySchedule = aesWasm(AESAlgo.wasm).getInvKeySchedule(keySize, keyWords);
  }

  // eslint-disable-next-line no-dupe-class-members
  _process(doFlush) {
    if (!AESAlgo.wasm) {
      throw new Error('WASM is not loaded yet. \'loadWasm\' should be called first');
    }
    let processedWords;

    // Shortcuts
    const data = this._data;
    let dataWords = data.words;
    const dataSigBytes = data.sigBytes;
    const blockSize = this.blockSize;
    const blockSizeBytes = blockSize * 4;

    // Count blocks ready
    let nBlocksReady = dataSigBytes / blockSizeBytes;
    if (doFlush) {
      // Round up to include partial blocks
      nBlocksReady = Math.ceil(nBlocksReady);
    } else {
      // Round down to include only full blocks,
      // less the number of blocks that must remain in the buffer
      nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0);
    }

    // Count words ready
    const nWordsReady = nBlocksReady * blockSize;

    // Count bytes ready
    const nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);

    // Process blocks
    if (nWordsReady) {
      // dataArray.length should be n * 4
      if (dataWords.length % 4 != 0) {
        let count = 4 - dataWords.length % 4;
        while (count-- > 0) {
          dataWords.push(0);
        }
      }
      const dataArray = new Uint32Array(dataWords);
      const ivWords = this.cfg.iv ? this.cfg.iv.words : '';
      // Perform concrete-algorithm logic
      if (this._xformMode == this._ENC_XFORM_MODE) {
        aesWasm(AESAlgo.wasm).doEncrypt(this.cfg.mode.name, this._nRounds, nWordsReady, blockSize, ivWords, dataArray, this._keySchedule);
      } else /* if (this._xformMode == this._DEC_XFORM_MODE) */ {
        aesWasm(AESAlgo.wasm).doDecrypt(this.cfg.mode.name, this._nRounds, nWordsReady, blockSize, ivWords, dataArray, this._keySchedule, this._invKeySchedule);
      }
      dataWords = Array.from(dataArray);
      // Remove processed words
      processedWords = dataWords.splice(0, nWordsReady);

      data.sigBytes -= nBytesReady;
    }

    // Return processed words
    return new WordArray(processedWords, nBytesReady);
  }
}

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     const ciphertext = CryptoJS.AES.encrypt(message, key, cfg);
 *     const plaintext  = CryptoJS.AES.decrypt(ciphertext, key, cfg);
 */
export const AES = BlockCipher._createHelper(AESAlgo);

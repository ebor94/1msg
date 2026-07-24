'use strict';
let io = null;
function setIo(instancia) { io = instancia; }
function getIo() { return io; }
module.exports = { setIo, getIo };

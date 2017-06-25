/**
 * @module pcm-convert
 */
'use strict'

var os = require('os')
var assert = require('assert')
var isBuffer = require('is-buffer')

module.exports = function convert (buffer, from, to) {
	assert(buffer, 'First argument should be data')
	assert(from, 'Second argument should be dtype or format object')

	if (typeof from === 'string') {
		from = parse(from)
	}
	if (typeof to === 'string') {
		to = parse(to)
	}
	if (!to) to = {dtype: 'float32', interleaved: false}

	if (from.dtype == null) {
		from.dtype = dtype(buffer)
	}

	if (to.channels == null) {
		to.channels = from.channels
	}

	normalize(from)
	normalize(to)

	//ignore same format
	if (from.dtype === to.dtype &&
		from.interleaved === to.interleaved &&
		from.endianness === to.endianness) return buffer

	//convert buffer/alike to arrayBuffer
	var data
	if (buffer instanceof ArrayBuffer) {
		data = buffer
	}
	else if (ArrayBuffer.isView(buffer)) {
		if (buffer.byteOffset != null) data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		else data = buffer.buffer;
	}
	else {
		data = (new Uint8Array(buffer.length != null ? buffer : [buffer])).buffer
	}

	//create containers for conversion
	var fromArray = new (dtypes[from.dtype])(data)

	//toArray is automatically filled with mapped values
	//but in some cases mapped badly, e. g. float → int(round + rotate)
	var toArray = new (dtypes[to.dtype])(fromArray)

	//if range differ, we should apply more thoughtful mapping
	if (from.max !== to.max) {
		var fromRange = from.max - from.min, toRange = to.max - to.min
		for (var i = 0, l = fromArray.length; i < l; i++) {
			var value = fromArray[i]

			//ignore not changed range
			//bring to 0..1
			var normalValue = (value - from.min) / fromRange

			//bring to new format ranges
			value = normalValue * toRange + to.min

			//clamp (buffers do not like values outside of bounds)
			toArray[i] = Math.max(to.min, Math.min(to.max, value))
		}
	}

	//reinterleave, if required
	if (from.interleaved != to.interleaved) {
		var channels = from.channels
		var len = Math.floor(fromArray.length / channels)

		//deinterleave
		if (from.interleaved && !to.interleaved) {
			toArray = toArray.map(function (value, idx, data) {
				var targetOffset = idx % len
				var targetChannel = ~~(idx / len)

				return data[targetOffset * channels + targetChannel]
			})
		}
		//interleave
		else if (!from.interleaved && to.interleaved) {
			toArray = toArray.map(function (value, idx, data) {
				var targetOffset = ~~(idx / channels)
				var targetChannel = idx % channels

				return data[targetChannel * len + targetOffset]
			})
		}
	}

	//ensure endianness
	if (to.dtype != 'array' && from.endianness !== to.endianness) {
		var le = to.endianness === 'le'
		var view = new DataView(toArray.buffer)
		var step = toArray.BYTES_PER_ELEMENT
		var methodName = 'set' + to.dtype[0].toUpperCase() + to.dtype.slice(1)
		for (var i = 0, l = toArray.length; i < l; i++) {
			view[methodName](i*step, toArray[i], le)
		}
	}

	return toArray
}


var dtypes = {
	'uint8': Uint8Array,
	'uint8_clamped': Uint8ClampedArray,
	'uint16': Uint16Array,
	'uint32': Uint32Array,
	'int8': Int8Array,
	'int16': Int16Array,
	'int32': Int32Array,
	'float32': Float32Array,
	'float64': Float64Array,
	'array': Array
}

//attempt to parse string
function parse (str) {
	var format = {}
	var parts = str.split(/\s+/)

	for (var i = 0; i < parts.length; i++) {
		var part = parts[i].toLowerCase()

		if (part === 'planar') format.interleaved = false
		else if (part === 'interleaved') format.interleaved = true
		else if (part === 'stereo') format.channels = 2
		else if (part === 'mono') format.channels = 1
		else if (part === '5.1') format.channels = 4
		else if (part === 'le') format.endianness = 'le'
		else if (part === 'be') format.endianness = 'be'
		else if (dtypes[part]) format.dtype = part
		else throw Error('Cannot identify part `' + part + '`')
	}

	return format
}

//make sure all format properties are present
function normalize (obj) {
	if (obj.interleaved == null) obj.interleaved = false
	if (obj.channels == null) obj.channels = obj.interleaved ? 2 : 1
	if (obj.dtype == null) obj.dtype = 'float32'
	if (obj.endianness == null) obj.endianness = os.endianness instanceof Function ? os.endianness() : 'LE'

	switch (obj.dtype) {
		case 'float32':
		case 'float64':
		case 'array':
			obj.min = -1
			obj.max = 1
			break;
		case 'uint8':
		case 'uint8_clamped':
			obj.min = 0
			obj.max = 255
			break;
		case 'uint16':
			obj.min = 0
			obj.max = 65535
			break;
		case 'uint32':
			obj.min = 0
			obj.max = 4294967295
			break;
		case 'int8':
			obj.min = -128
			obj.max = 127
			break;
		case 'int16':
			obj.min = -32768
			obj.max = 32767
			break;
		case 'int32':
			obj.min = -2147483648
			obj.max = 2147483647
			break;
	}

	return obj
}

//detect dtype string of an array
function dtype (array) {
	if (array instanceof Float32Array) return 'float32'
	if (array instanceof Float64Array) return 'float64'
	if (array instanceof ArrayBuffer) return 'uint8'
	if (isBuffer(array)) return 'uint8'
	if (array instanceof Uint8Array) return 'uint8'
	if (array instanceof Uint8ClampedArray) return 'uint8'
	if (array instanceof Int8Array) return 'int8'
	if (array instanceof Int16Array) return 'int16'
	if (array instanceof Uint16Array) return 'uint16'
	if (array instanceof Int32Array) return 'int32'
	if (array instanceof Uint32Array) return 'uint32'

	return 'float32'
}

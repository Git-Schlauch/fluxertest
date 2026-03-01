/*
 * Copyright (C) 2026 Fluxer Contributors
 *
 * This file is part of Fluxer.
 *
 * Fluxer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Fluxer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Fluxer. If not, see <https://www.gnu.org/licenses/>.
 */

function getRandomByte(): number {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj?.getRandomValues) {
		const bytes = new Uint8Array(1);
		cryptoObj.getRandomValues(bytes);
		return bytes[0] ?? 0;
	}

	return Math.floor(Math.random() * 256);
}

function toHex(byte: number): string {
	return byte.toString(16).padStart(2, '0');
}

export function generateUUID(): string {
	const nativeRandomUUID = globalThis.crypto?.randomUUID;
	if (typeof nativeRandomUUID === 'function') {
		return nativeRandomUUID.call(globalThis.crypto);
	}

	// RFC4122 v4 fallback for non-secure contexts where randomUUID is unavailable.
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i += 1) {
		bytes[i] = getRandomByte();
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	return [
		toHex(bytes[0]) + toHex(bytes[1]) + toHex(bytes[2]) + toHex(bytes[3]),
		toHex(bytes[4]) + toHex(bytes[5]),
		toHex(bytes[6]) + toHex(bytes[7]),
		toHex(bytes[8]) + toHex(bytes[9]),
		toHex(bytes[10]) + toHex(bytes[11]) + toHex(bytes[12]) + toHex(bytes[13]) + toHex(bytes[14]) + toHex(bytes[15]),
	].join('-');
}


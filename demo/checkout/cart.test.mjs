import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartTotal, lineTotal } from './cart.mjs'

test('an empty cart costs nothing', () => {
    assert.equal(cartTotal([]), 0)
})

test('a line costs price times quantity', () => {
    assert.equal(lineTotal({ price: 4, qty: 3 }), 12)
})

test('a cart costs the sum of its lines', () => {
    assert.equal(cartTotal([{ price: 4, qty: 3 }, { price: 10, qty: 1 }]), 22)
})

// A tiny checkout module with one bug, used by the Tabby on Dopame OS demo.
export function lineTotal (item) {
    return item.price + item.qty
}

export function cartTotal (items) {
    return items.reduce((sum, item) => sum + lineTotal(item), 0)
}

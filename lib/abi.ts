export const ASCEND_ENGINE_ABI = [
  { type: "function", name: "ascend", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "floor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ethIn" }],
    outputs: [{ type: "uint256", name: "ascendOut" }, { type: "uint256", name: "fee" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "ascendIn" }],
    outputs: [{ type: "uint256", name: "ethOut" }, { type: "uint256", name: "fee" }],
  },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "ascendIn" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { type: "address", name: "buyer", indexed: true },
      { type: "uint256", name: "ethIn" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ascendOut" },
      { type: "uint256", name: "newFloor" },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { type: "address", name: "seller", indexed: true },
      { type: "uint256", name: "ascendIn" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "newFloor" },
    ],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

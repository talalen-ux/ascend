export const ASCEND_HOOK_ABI = [
  { type: "function", name: "ascend", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "floor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "premiumBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cumulativeEthIn", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
  {
    type: "event",
    name: "Buy",
    inputs: [
      { type: "address", name: "swapper", indexed: true },
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
      { type: "address", name: "swapper", indexed: true },
      { type: "uint256", name: "ascendIn" },
      { type: "uint256", name: "fee" },
      { type: "uint256", name: "ethOut" },
      { type: "uint256", name: "newFloor" },
    ],
  },
] as const;

export const ASCEND_ROUTER_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { type: "uint256", name: "minOut" },
      { type: "address", name: "recipient" },
    ],
    outputs: [{ type: "uint256", name: "ascendOut" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "ascendIn" },
      { type: "uint256", name: "minOut" },
      { type: "address", name: "recipient" },
    ],
    outputs: [{ type: "uint256", name: "ethOut" }],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

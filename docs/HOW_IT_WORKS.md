# How ascend works (no jargon edition)

A short, plain-language explanation of every feature. No math, no
crypto vocabulary required. If something here uses a term you don't
know, that's a bug — tell us.

---

## What ascend is, in one sentence

Ascend is a token on Ethereum that has a self-strengthening price
floor and a daily lottery for holders. Every time someone trades it,
the protocol gets a little richer, and a portion of that goes to
whoever holds the token.

---

## The five things that make it different

### 1. There's a floor that only goes up

When you own ascend, there's a "floor price" — the minimum price the
token can be sold back at, guaranteed by the protocol's own
liquidity. Every single trade (buy or sell) makes that floor a tiny
bit higher. It can never go down. **Ever.**

So if the floor today is $0.10 and tomorrow is $0.11, that means it
will be at least $0.11 forever.

The market price is usually higher than the floor (like, much
higher). The floor is your safety net, not your ceiling.

### 2. The market price moves like a normal token

When people buy, price goes up. When people sell, price goes down.
Standard candle chart, green and red, just like every other token on
DexScreener. No weird mechanics here — the curve is the standard
Uniswap math.

The trick is that the floor (the safety net) keeps creeping up
underneath, even as the price wobbles around above it.

### 3. Every trade has a 1% fee + a $2 flat charge to mint

If you buy or sell ascend, 1% of your trade goes back into the
protocol. If you buy specifically, there's an additional flat ~$2 fee
on top. Sells don't pay the flat fee.

Where does that 1%-plus-$2 go?
- **70%** stays in the liquidity pool, which is what raises the floor
  for everyone holding.
- **30%** goes to the daily lottery (see #4).

The flat $2 mostly exists to discourage tiny spam trades. If you're
trading $5 worth, the $2 is huge. If you're trading $5,000 worth,
the $2 is rounding error.

### 4. The 12×12 tile lottery (this is the unique part)

There's a separate contract called the "TileEngine" that has a 12×12
grid of 144 tiles. Once every 24 hours, **anyone holding at least 1
ascend** can click one tile and flip it.

When you flip a tile, it reveals a random multiplier between 1× and
4×, and you get paid **in ETH** based on that multiplier. (The pool
is filled with ETH from the 30% fee share, so claims pay ETH back to
the holder's wallet directly.)

The exact odds:
- **62.5%** chance of 1× (smallest payout)
- **18.75%** chance of 2×
- **12.5%** chance of 3×
- **6.25%** chance of 4× (jackpot)

The pool you're claiming from is funded by the 30% of trading fees
mentioned above. So the more people trade ascend, the bigger the
daily prizes. If almost nobody trades, the daily prize is small. If
trading is active, the daily prize is real money.

Each address only gets one tile flip per day. If you don't claim,
your share rolls into tomorrow's pot.

### 5. There's no team, no admin, no secret backdoor

When ascend is deployed, all 122 million tokens are immediately
locked into the trading pool. The team gets exactly zero. There's no
allocation to insiders, no presale, no vesting unlock hidden in the
code.

After deployment, **nobody can change anything**. The contract has
no admin function, no pause button, no upgrade path. The only way it
operates is the rules baked into the code at launch.

---

## Walking through what happens when you buy

You decide to buy 0.5 ETH worth of ascend.

1. You go to Uniswap (or DexScreener, or 1inch — anywhere that
   supports trading on Uniswap V4) and swap 0.5 ETH for ascend.
2. You pay a fee. With 1% base + the $2 flat, your effective fee on
   a 0.5 ETH (~$1175) buy is about 1.2%.
3. The trade goes through. You get however much ascend the curve
   gives you for your 0.495 ETH net.
4. Behind the scenes:
   - 70% of your fee gets added back to the liquidity pool. This
     raises the floor for every existing holder including you.
   - 30% goes to the TileEngine for tomorrow's lottery.
5. You now own ascend. You can:
   - Hold it (most people do).
   - Sell it (subject to a 1% fee on the way out).
   - Wait 24 hours and flip a tile to claim a piece of the lottery.

---

## Walking through what happens when you sell

You decide to sell 1000 ascend.

1. You go to the same Uniswap interface and swap your 1000 ascend
   back to ETH.
2. You pay a 1% fee on the trade. No flat charge on sells.
3. You get ETH out, minus 1%. The amount you get is determined by
   the curve — selling moves the price down a bit, just like any
   normal token.
4. The 1% fee splits 70/30 like buys: 70% raises the floor, 30%
   goes to the tile lottery pool.
5. **Important rule:** if you bought ascend in the same block (≈12
   seconds) as you're trying to sell, the sell will fail. This is
   anti-flash-loan protection. Wait one block and try again.

---

## Walking through how the tile lottery feels

It's 9am and the daily epoch just rolled over. You hold some ascend.

1. You open the dapp and see the 12×12 grid. All 144 tiles are
   "available" (dimmed but clickable).
2. The header tells you the current pool size — say $5,000 worth of
   ETH is in the TileEngine right now.
3. You click any tile. Your wallet pops up to confirm the
   transaction.
4. After ~30 seconds, the tile flips. A modal appears: "**You won
   3×!** You receive ~0.026 ETH (~$64)."
5. The ETH lands in your wallet immediately. You can hold it,
   stack more ETH, or buy more ascend with it.
6. Throughout the day, other holders flip their tiles. By late
   evening, most tiles are taken. Whatever pool wasn't claimed rolls
   into tomorrow's epoch.

You can claim again starting at the next 9am rollover.

---

## Where the value comes from

Some "rewards" tokens are unsustainable — they print new tokens out
of thin air to pay holders, which dilutes everyone over time. Ascend
isn't doing that. The supply is fixed at 122 million forever.

The rewards come from **real trading activity**:
- Someone buys → 1.2% of their money goes into the pools
- Someone sells → 1% of their money goes into the pools
- The lottery pool grows
- Holders claim their share of that pool

If trading dies, the lottery shrinks. If trading is active, the
lottery is big. The token's value capture is honest — there's no
illusion of yield where there's no underlying revenue.

The floor compounds the same way: every fee from every trade gets
added back to the liquidity that backs your tokens. The more people
trade, the higher the floor. The longer you hold, the more of those
fee-additions accumulate beneath you.

---

## What can go wrong

Being honest:

- **The token's price can drop.** The floor only protects the
  minimum redemption value, not the market price. Market price could
  go below your buy price even though the floor is rising.
- **Volume can dry up.** If nobody trades, the lottery pool stays
  small and the floor barely moves. The protocol's flywheel needs
  trading activity to spin.
- **A whale can dominate the launch.** There's no per-transaction
  cap on buys. If someone has a lot of ETH, they can buy a big chunk
  in the first block. The protocol doesn't try to prevent this.
- **Flash-loan arbitrage** is mostly defended (you can't buy and sell
  in the same block) but sophisticated MEV attackers may still find
  edges around major price moves.
- **The first 100 blocks** after launch have a small randomized extra
  fee on buys (0–1%) to make bot-snipers slightly less profitable.
  If you're buying right at launch, you'll pay a tiny extra fee on
  average. After ~20 minutes this disappears.

---

## What you can ignore (it's just words)

You don't need to understand any of these to use ascend, but you
might see them in marketing:

- **"V4 hook"** — ascend uses Uniswap V4's hook system, which lets
  the protocol customize how trading works. You don't need to know
  how this works to trade.
- **"Constant product LP"** — the math behind the curve. Same as
  what every Uniswap pool has used since 2020.
- **"Floor monotone non-decreasing"** — fancy way of saying "the
  floor only goes up."
- **"Genesis bootstrap"** — the 1 ETH of starting liquidity that the
  founder seeds when deploying the contract.
- **"122M cap"** — there will only ever be 122 million ascend
  tokens. No more can be created.

---

## Quick FAQ

**Q: Do I need to do anything to get the floor benefit?**
A: No. Just hold ascend. The floor rises automatically with every
trade anyone makes.

**Q: Do I have to claim the lottery every day?**
A: No, but if you don't, your share rolls into the next day's pool
for everyone else. Skip claims forfeit value to other holders.

**Q: Can the team rug me?**
A: No. There is no admin key. The team owns no tokens. There is no
function in the contract that lets anyone (including the team) take
your tokens or drain the liquidity pool.

**Q: Why 122 million?**
A: It's a chosen cap with no special technical meaning. The math
works at any cap; this is just the number we picked.

**Q: What if I want to sell a really small amount?**
A: There's a minimum buy of about $2 worth. Below that, the trade
will revert. Sells have no minimum.

**Q: How fast does the floor rise?**
A: It depends on volume. With $15M/day of trading, the floor would
roughly double every few weeks. With $1M/day, it'd take longer.
Linear in volume.

**Q: Where do I see the floor?**
A: It's displayed live in the ascend dapp. You can also read it
directly from the contract on Etherscan by calling the `floor()`
function.

**Q: Is this a get-rich-quick scheme?**
A: No. Speculation around ascend can absolutely make or lose money
fast — that's true of any token. The floor mechanic is a long-term
durability feature, not a yield-pumping one. Treat it as a normal
token with two unusual properties (rising floor, daily lottery).

"""FOLD / CITY design-verification sketch (throwaway, not production code).

Each puzzle is a finite state machine over (player_region, puzzle_state).
Walking inside the current connectivity is free; using a console costs 1 action.
0-1 BFS gives the minimum number of actions; a reverse search finds dead-end
states (states from which the goal is unreachable without the global reset).
"""
from collections import deque
import math

# ---------------------------------------------------------------- solver
def explore(start, connected, actions, is_goal):
    """connected(state) -> list[set[region]] ; actions(region, state) -> [(label, new_state)]"""
    def walk(region, state):
        for comp in connected(state):
            if region in comp:
                return comp
        return {region}

    dist, parent = {start: 0}, {start: None}
    dq = deque([start])
    while dq:
        node = dq.popleft()
        region, state = node
        for r in walk(region, state):  # free moves
            nxt = (r, state)
            if nxt not in dist or dist[nxt] > dist[node]:
                dist[nxt], parent[nxt] = dist[node], (node, f"walk->{r}")
                dq.appendleft(nxt)
        for label, ns in actions(region, state):  # paid moves
            nxt = (region, ns)
            if nxt not in dist or dist[nxt] > dist[node] + 1:
                dist[nxt], parent[nxt] = dist[node] + 1, (node, label)
                dq.append(nxt)
    goals = [n for n in dist if is_goal(n)]
    best = min((dist[g] for g in goals), default=None)

    # reverse reachability: which explored states can still reach a goal?
    succ = {n: set() for n in dist}
    for n in dist:
        region, state = n
        for r in walk(region, state):
            succ[n].add((r, state))
        for _, ns in actions(region, state):
            succ[n].add((region, ns))
    can = set(goals)
    changed = True
    while changed:
        changed = False
        for n, ss in succ.items():
            if n not in can and ss & can:
                can.add(n); changed = True
    dead = [n for n in dist if n not in can]

    path = []
    if best is not None:
        g = min(goals, key=lambda n: dist[n])
        while parent[g] is not None:
            g, label = parent[g]
            if not label.startswith("walk"):
                path.append((g[0], label))
        path.reverse()
    return dict(best=best, states=len(dist), dead=dead, path=path, dist=dist)


def first_move_penalties(start, connected, actions, is_goal):
    """For every action available from the start region: extra actions vs optimal."""
    base = explore(start, connected, actions, is_goal)["best"]
    out = []
    for label, ns in actions(*start):
        r = explore((start[0], ns), connected, actions, is_goal)["best"]
        out.append((label, None if r is None else 1 + r - base))
    return out

# ---------------------------------------------------------- 1-2 The Cube
UP, DOWN = (0, 1, 0), (0, -1, 0)
N, S, E, W = (0, 0, -1), (0, 0, 1), (1, 0, 0), (-1, 0, 0)   # three.js: north = -Z
NAME = {N: "N", S: "S", E: "E", W: "W", UP: "U", DOWN: "D"}

def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))

def apply(m, v):
    return tuple(sum(m[i][k] * v[k] for k in range(3)) for i in range(3))

I3 = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
RX = ((1, 0, 0), (0, 0, -1), (0, 1, 0))   # +90 deg about world X : top rolls to the south
RY = ((0, 0, 1), (0, 1, 0), (-1, 0, 0))   # +90 deg about world Y

def power(m, k):
    r = I3
    for _ in range(k % 4):
        r = mat_mul(m, r)
    return r

# Face patterns in the cube's initial frame: list of edge groups (edges in a group are joined).
FACES = {
    "top":    (UP,   [[N, S]]),            # straight N-S: blocks W->E at the start
    "north":  (N,    [[W, DOWN]]),         # rolled up (+90 X) it reads W-N
    "bottom": (DOWN, [[N, E, S]]),         # T-junction without W
    "south":  (S,    [[W, DOWN]]),         # rolled up (-90 X) it reads W-S (mural balcony)
    "east":   (E,    [[UP, DOWN]]),
    "west":   (W,    [[N, S]]),
}

def top_groups(orient):
    for name, (normal, groups) in FACES.items():
        if apply(orient, normal) == UP:
            return name, [[NAME[apply(orient, e)] for e in g] for g in groups]
    raise AssertionError

def cube_connected(orient):
    _, groups = top_groups(orient)
    return [set(g) for g in groups]

def cube_actions_factory(any_angle):
    ks = (1, 2, 3) if any_angle else (1,)
    def actions(region, orient):
        out = []
        if region == "W":
            out += [(f"roll X{90*k}", mat_mul(power(RX, k), orient)) for k in ks]
        if region == "N":
            out += [(f"yaw Y{90*k}", mat_mul(power(RY, k), orient)) for k in ks]
        return out
    return actions

def cube_report():
    print("== 1-2 The Cube (consoles: roll@W, yaw@N; goal E) ==")
    for any_angle in (True, False):
        acts = cube_actions_factory(any_angle)
        res = explore(("W", I3), cube_connected, acts, lambda n: n[0] == "E")
        print(f" console picks any angle={any_angle}: min actions={res['best']}, "
              f"explored states={res['states']}, dead-end states={len(res['dead'])}")
        print("   optimal:", res["path"])
    acts = cube_actions_factory(True)
    print("  roll-only states reachable from W (what a brute-forcer at W can see):")
    for k in range(4):
        o = power(RX, k)
        print(f"   roll {90*k:3d}: top face={top_groups(o)[0]:6s} paths={top_groups(o)[1]}")
    print("  first-move penalties:", first_move_penalties(("W", I3), cube_connected, acts,
                                                          lambda n: n[0] == "E"))
    # all orientations reachable with any number of actions
    res = explore(("W", I3), cube_connected, acts, lambda n: n[0] == "E")
    orients = {s for (_, s) in res["dist"]}
    print(f"  distinct cube orientations reachable: {len(orients)} / 24")

# ------------------------------------------------ 1-3 Fold Gate (interference)
# T: tower arm, 4 states. arm bridges N0-L only at t=2; arm intrudes H's sweep at t in {0,2}.
# H: hinged street slab, up/down. Down: N0, L and P are joined by the street.
BLOCKING = {0, 2}

def gate_connected(state):
    t, h = state
    comps = []
    if h == "down":
        comps.append({"N0", "L", "P"})
    elif t == 2:
        comps.append({"N0", "L"})
    return comps

def t_path(t, t2):
    """intermediate+target states swept when rotating the tower (shorter way, cw on ties)."""
    d = (t2 - t) % 4
    step = 1 if d <= 2 else -1
    seq, cur = [], t
    while cur != t2:
        cur = (cur + step) % 4
        seq.append(cur)
    return seq

def gate_actions(region, state):
    t, h = state
    out = []
    if region in ("N0", "L"):
        for t2 in range(4):
            if t2 == t:
                continue
            if h == "down" and any(s in BLOCKING for s in t_path(t, t2)):
                continue  # arm would sweep through the lowered street
            out.append((f"tower->{t2}", (t2, h)))
    if region == "L" and t not in BLOCKING:
        out.append(("fold street " + ("down" if h == "up" else "up"),
                    (t, "down" if h == "up" else "up")))
    return out

def gate_report():
    print("== 1-3 Fold Gate (tower arm interference) ==")
    start = ("N0", (0, "up"))
    res = explore(start, gate_connected, gate_actions, lambda n: n[0] == "P")
    print(f" min actions={res['best']}, explored states={res['states']}, dead-end states={len(res['dead'])}")
    print("   optimal:", res["path"])
    print("   first-move penalties:", first_move_penalties(start, gate_connected, gate_actions,
                                                            lambda n: n[0] == "P"))

# --------------------------------------- Area 3 concept: Penrose loop as a winding key
# Positions: C0..C3 corner landings of a 4-flight loop, X = exit corridor, CORE.
# Walking up from C3 into C0 crosses the periodic seam: lap += 1 (mod 4); down: lap -= 1.
# Door C0->X exists only in mirror layer B. Bridge X->CORE aligned only when lap == 2.
def penrose_neighbors(node):
    pos, lap, layer = node
    out = []
    ring = ["C0", "C1", "C2", "C3"]
    if pos in ring:
        i = ring.index(pos)
        up = ring[(i + 1) % 4]
        down = ring[(i - 1) % 4]
        out.append((0, (up, (lap + 1) % 4 if pos == "C3" else lap, layer)))
        out.append((0, (down, (lap - 1) % 4 if pos == "C0" else lap, layer)))
        if pos == "C2":
            out.append((1, (pos, lap, "B" if layer == "A" else "A")))  # mirror gate
        if pos == "C0" and layer == "B":
            out.append((0, ("X", lap, layer)))
    if pos == "X":
        out.append((0, ("C0", lap, layer)))
        if lap == 2:
            out.append((0, ("CORE", lap, layer)))
    return out

def penrose_report():
    print("== Area 3 concept (Penrose loop = winding key, mirror gate at C2) ==")
    start = ("C0", 0, "A")
    # lexicographic cost: (actions, flights walked) via Dijkstra-ish 0-1 on actions then flights
    import heapq
    best = {start: (0, 0)}
    pq = [(0, 0, start, [])]
    while pq:
        a, f, node, path = heapq.heappop(pq)
        if node[0] == "CORE":
            print(f" min actions={a}, flights walked={f}, path={path}")
            break
        for cost, nxt in penrose_neighbors(node):
            key = (a + cost, f + (0 if cost else 1))
            if nxt not in best or best[nxt] > key:
                best[nxt] = key
                heapq.heappush(pq, (*key, nxt, path + [nxt]))
    print(f" reachable states={len(best)} (positions x lap mod 4 x layer)")

# ------------------------------------------------- Area 2: spiral geometry check
def spiral_report():
    print("== Area 2 Archimedean spiral walkway: r = r_out - b*theta, h = c*theta ==")
    print(" r_out r_in  w  g | b(m/rad) turns  length  rise | grade_max rho_min | quarter-turn shift (radial, vertical)")
    for r_out, r_in, w, g, pitch in [(26, 10, 4, 4, 6), (28, 12, 4, 6, 8), (24, 12, 4, 4, 4), (30, 14, 4, 8, 6)]:
        s = w + g
        b = s / (2 * math.pi)
        c = pitch / (2 * math.pi)
        tmax = (r_out - r_in) / b
        n = 20000
        length = sum(math.hypot(r_out - b * (tmax * (i + .5) / n), b) * tmax / n for i in range(n))
        grade = c / math.hypot(r_in, b)
        rho = (r_in ** 2 + b ** 2) ** 1.5 / (r_in ** 2 + 2 * b ** 2)
        print(f" {r_out:4d} {r_in:4d} {w:2d} {g:2d} | {b:7.3f}  {tmax/(2*math.pi):4.2f}  {length:6.1f}  {c*tmax:5.1f} |"
              f"   {grade*100:5.1f}%  {rho:6.2f} | ({s/4:4.2f} m, {pitch/4:4.2f} m)")
    # swept radius of a cube rotating about its centre (adjacent-module clearance rule)
    for side in (4, 8, 12):
        print(f" cube side {side:2d} m rotating about centre sweeps radius {side*math.sqrt(2)/2:5.2f} m "
              f"-> clearance needed {side*(math.sqrt(2)-1)/2:4.2f} m beyond its faces")

if __name__ == "__main__":
    cube_report(); print()
    gate_report(); print()
    penrose_report(); print()
    spiral_report()

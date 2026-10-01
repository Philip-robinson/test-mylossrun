import {
  wavySegmentPath,
  waveCyclePath,
  tableOutlinePath,
} from 'components/pdfTableViewer/wavyLineUtils';

// Split a path string into commands: [{ cmd, args: [numbers] }].
function parsePath(d) {
  const out = [];
  const re = /([MLA])([^MLA]*)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    out.push({ cmd: m[1], args });
  }
  return out;
}

// Arc args: rx ry rotation large-arc sweep x y.
const arcEnd = (a) => ({ x: a.args[5], y: a.args[6] });

describe('wavyLineUtils', () => {
  describe('wavySegmentPath', () => {
    it('starts at x1 y, uses alternating pitch/2-wide arcs, ends at x2 y', () => {
      const cmds = parsePath(wavySegmentPath(10, 50, 20, 4, 8));
      expect(cmds[0]).toEqual({ cmd: 'M', args: [10, 20] });
      const arcs = cmds.slice(1);
      expect(arcs.length).toBe(10);
      expect(arcs.every((c) => c.cmd === 'A')).toBe(true);
      let x = 10;
      arcs.forEach((a, i) => {
        expect(a.args[0]).toBeCloseTo(2);
        expect(a.args[1]).toBeCloseTo(2);
        expect(a.args[4]).toBe(i % 2 === 0 ? 1 : 0);
        const end = arcEnd(a);
        expect(end.x - x).toBeCloseTo(4);
        expect(end.y).toBeCloseTo(20);
        x = end.x;
      });
      expect(x).toBeCloseTo(50);
    });

    it('ends a partial remainder in one narrower arc landing on x2', () => {
      const arcs = parsePath(wavySegmentPath(0, 10, 5, 4, 8)).slice(1);
      expect(arcs.length).toBe(3);
      const last = arcs[2];
      expect(last.args[0]).toBeCloseTo(1);
      expect(last.args[4]).toBe(1);
      expect(arcEnd(last).x).toBeCloseTo(10);
      expect(arcEnd(last).y).toBeCloseTo(5);
      expect(arcEnd(arcs[1]).x).toBeCloseTo(8);
    });

    it('returns a straight line when x2 <= x1', () => {
      const cmds = parsePath(wavySegmentPath(30, 30, 7, 4, 8));
      expect(cmds).toEqual([
        { cmd: 'M', args: [30, 7] },
        { cmd: 'L', args: [30, 7] },
      ]);
      const back = parsePath(wavySegmentPath(30, 10, 7, 4, 8));
      expect(back.map((c) => c.cmd)).toEqual(['M', 'L']);
      expect(back[1].args).toEqual([10, 7]);
    });
  });

  describe('waveCyclePath', () => {
    it('runs from (0, h/2) to (pitch, h/2) in two arcs', () => {
      const cmds = parsePath(waveCyclePath(6, 12));
      expect(cmds[0]).toEqual({ cmd: 'M', args: [0, 3] });
      const arcs = cmds.slice(1);
      expect(arcs.length).toBe(2);
      expect(arcs.every((c) => c.cmd === 'A')).toBe(true);
      expect(arcs[0].args[4]).not.toBe(arcs[1].args[4]);
      expect(arcEnd(arcs[0])).toEqual({ x: 6, y: 3 });
      expect(arcEnd(arcs[1])).toEqual({ x: 12, y: 3 });
    });
  });

  describe('tableOutlinePath', () => {
    // Split into sub-paths at each M.
    const subPaths = (d) => {
      const cmds = parsePath(d);
      const out = [];
      cmds.forEach((c) => {
        if (c.cmd === 'M') out.push([c]);
        else out[out.length - 1].push(c);
      });
      return out;
    };

    it('draws four sub-paths, arcs only on the wavy edges', () => {
      const subs = subPaths(tableOutlinePath(0, 0, 40, 20, false, true, 4, 8));
      expect(subs.length).toBe(4);
      const [top, right, bottom, left] = subs;
      expect(top[0].args).toEqual([0, 0]);
      expect(top.slice(1).map((c) => c.cmd)).toEqual(['L']);
      expect(top[1].args).toEqual([40, 0]);
      expect(right[0].args).toEqual([40, 0]);
      expect(right[1]).toEqual({ cmd: 'L', args: [40, 20] });
      expect(bottom[0].args).toEqual([0, 20]);
      expect(bottom.slice(1).every((c) => c.cmd === 'A')).toBe(true);
      expect(arcEnd(bottom[bottom.length - 1]).x).toBeCloseTo(40);
      expect(left[0].args).toEqual([0, 20]);
      expect(left[1]).toEqual({ cmd: 'L', args: [0, 0] });
    });

    it('draws a wavy top when wavyTop', () => {
      const [top, , bottom] = subPaths(
        tableOutlinePath(5, 5, 16, 10, true, false, 4, 8),
      );
      expect(top.slice(1).every((c) => c.cmd === 'A')).toBe(true);
      expect(bottom.slice(1).map((c) => c.cmd)).toEqual(['L']);
    });

    it('is all straight when neither edge is wavy', () => {
      const d = tableOutlinePath(1, 2, 30, 40, false, false, 4, 8);
      const cmds = parsePath(d);
      expect(cmds.filter((c) => c.cmd === 'M').length).toBe(4);
      expect(cmds.some((c) => c.cmd === 'A')).toBe(false);
    });
  });
});

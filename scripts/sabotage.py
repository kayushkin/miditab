#!/usr/bin/env python3
"""Apply one source mutation, rebuild, run the suite, report whether it reddened.

Ported from chat-core's `scripts/sabotage-failure-value.py` (card `e9b2bdf2`)
rather than re-derived, per the standing signpost: copy the mechanism.

Two things are different here, and the first one is the reason this file exists
at all instead of a symlink.

**The suite tests `dist/`, not `src/`.** `test/roundtrip.test.mjs` imports
`../dist/index.js`, so a mutation to `src/` that is not followed by `tsc` is
tested against the previous build and every mutation reads as UNNOTICED.
Measured: replacing the whole body of `renderAscii` with `return ""` passes
7/7 without a rebuild and fails 3/7 with one. A sweep that forgets the build
step does not find a weak suite, it manufactures one -- and reports it in the
confident shape of a finding. `run_suite` therefore builds first, always, and
refuses to report a suite verdict when the build failed.

**A mutation can fail to compile.** `tsc` is a second observer standing in
front of the tests, and it is not the one under measurement here. A mutation
the compiler rejects tells us nothing about the suite, so it gets its own
verdict (BUILD-FAILED) and is a defect in the PLAN -- rewrite the mutation
into one that compiles -- never a pass and never a catch.
"""

import json
import subprocess
import sys
from pathlib import Path

# The repository this scorer belongs to, found from the scorer's own location,
# so it survives being run from a worktree or another directory.
ROOT = Path(__file__).resolve().parent.parent
PLAN_DIRECTORY = ROOT / "scripts" / "sabotage-plans"


def build():
    """Compile src/ to dist/. Returns (ok, output)."""
    finished = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=600
    )
    return finished.returncode == 0, finished.stdout + finished.stderr


def run_suite():
    """Rebuild, then run the suite. Returns (verdict_input, output).

    verdict_input is None when the build failed, which is NOT the same as the
    suite passing and must never be collapsed into it.
    """
    built, build_output = build()
    if not built:
        return None, build_output
    finished = subprocess.run(
        ["npm", "test"], cwd=ROOT, capture_output=True, text=True, timeout=600
    )
    return finished.returncode, finished.stdout + finished.stderr


def apply_mutation(mutation):
    """Returns a restore callable. Raises if the mutation does not apply cleanly.

    Refuses a pattern that is absent or ambiguous, so a mutation that silently
    applied nowhere cannot be scored as "the tests caught it".
    """
    edits = mutation["edits"]
    originals = {}
    for edit in edits:
        path = ROOT / edit["file"]
        originals.setdefault(str(path), path.read_text())
    try:
        for edit in edits:
            path = ROOT / edit["file"]
            text = path.read_text()
            occurrences = text.count(edit["old"])
            if occurrences != 1:
                raise RuntimeError(
                    f"{edit['file']}: pattern occurs {occurrences} times, need exactly 1:\n"
                    f"  {edit['old'][:120]!r}"
                )
            path.write_text(text.replace(edit["old"], edit["new"]))
    except Exception:
        for filename, text in originals.items():
            Path(filename).write_text(text)
        raise

    def restore():
        for filename, text in originals.items():
            Path(filename).write_text(text)

    return restore


def score(mutation):
    restore = apply_mutation(mutation)
    try:
        code, output = run_suite()
    finally:
        restore()
    # Leave the tree compiling again, so the next mutation -- and any human who
    # walks in afterwards -- starts from a dist/ that matches src/.
    build()

    failing = [
        line.strip()
        for line in output.splitlines()
        if line.strip().startswith(("not ok", "✖", "AssertionError", "error TS"))
    ]
    return {
        "id": mutation["id"],
        "kind": mutation["kind"],
        "describes": mutation["describes"],
        "plan": mutation["plan"],
        "expected_unnoticed": mutation.get("expected_unnoticed"),
        "built": code is not None,
        "caught": None if code is None else code != 0,
        "exit": code,
        "failing": failing[:14],
    }


LABELS = {
    "CAUGHT": "CAUGHT            ",
    "UNNOTICED": "UNNOTICED         ",
    "EXPECTED-UNNOTICED": "EXPECTED-UNNOTICED",
    "STALE-DECLARATION": "STALE-DECLARATION ",
    "DID-NOT-APPLY": "DID-NOT-APPLY     ",
    "BUILD-FAILED": "BUILD-FAILED      ",
}


def classify(result):
    """The verdict on one mutation.

    A declared `expected_unnoticed` is a claim about the code, and a claim that
    stops being true is worse than no claim -- so a declared mutation the suite
    DOES catch is reported as STALE-DECLARATION rather than quietly passing.
    That is the half an exemption list cannot do, and the 94th pass's rule.
    """
    if result.get("built") is False:
        return "BUILD-FAILED"
    if result["caught"] is None:
        return "DID-NOT-APPLY"
    declared = result.get("expected_unnoticed")
    if result["caught"]:
        return "STALE-DECLARATION" if declared else "CAUGHT"
    return "EXPECTED-UNNOTICED" if declared else "UNNOTICED"


def problems(results):
    """Every result a run must not pass over, as ready-to-print lines.

    Controls are judged separately, per plan -- see `control_problems`.
    """
    lines = []
    for result in results:
        verdict = classify(result)
        if result["kind"] == "control":
            # A control that misbehaved is still a problem, but it is
            # control_problems' problem. A control that did not COMPILE is
            # nobody's measurement at all, so it is reported here too.
            if verdict == "BUILD-FAILED":
                lines.append(
                    f"BUILD FAILED: {result['id']}: the control does not compile, "
                    "so the plan it vouches for measured nothing"
                )
            continue
        if verdict == "UNNOTICED":
            lines.append(f"UNNOTICED: {result['id']}: {result['describes']}")
        elif verdict == "DID-NOT-APPLY":
            # `error` is set by main()'s except branch. Read it defensively
            # anyway: a KeyError here would blame the plan for what is really a
            # malformed result, which is the 94th pass's "guard that names the
            # wrong thing confidently".
            reason = (result.get("error") or "no reason recorded").splitlines()[0]
            lines.append(f"DID NOT APPLY: {result['id']}: {reason}")
        elif verdict == "BUILD-FAILED":
            lines.append(
                f"BUILD FAILED: {result['id']}: tsc rejected the mutation, so the suite "
                "never judged it -- rewrite it into one that compiles"
            )
        elif verdict == "STALE-DECLARATION":
            lines.append(
                f"STALE DECLARATION: {result['id']} is declared expected_unnoticed "
                f"({result['expected_unnoticed']}) and the suite CAUGHT it. "
                "The declaration is out of date -- delete it."
            )
    return lines


def control_problems(results):
    """Controls are judged per plan, never pooled: each plan carries its own pair,
    and a plan whose controls misbehaved has measured nothing, so pooling would let
    one plan's healthy pair vouch for another plan's broken run."""
    lines = []
    for plan_name in sorted({r["plan"] for r in results}):
        controls = {
            r["id"].split("/", 1)[1]: r
            for r in results
            if r["plan"] == plan_name and r["kind"] == "control"
        }
        if not controls:
            lines.append(f"{plan_name}: no controls, so the run vouches for nothing")
            continue
        positive = controls.get("CONTROL-POSITIVE")
        if positive is None or positive.get("caught") is not True:
            lines.append(f"{plan_name}: CONTROL-POSITIVE was not caught -- the suite never ran")
        negative = controls.get("CONTROL-NEGATIVE")
        if negative is None or negative.get("caught") is not False:
            lines.append(
                f"{plan_name}: CONTROL-NEGATIVE was caught -- the suite is red for a reason "
                "unrelated to any mutation"
            )
    return lines


def load_plans(arguments):
    """Every mutation named on the command line, or the whole plan directory."""
    paths = [Path(a) for a in arguments] if arguments else sorted(PLAN_DIRECTORY.glob("*.json"))
    if not paths:
        raise SystemExit(f"no plans: {PLAN_DIRECTORY} is empty and none were named")
    plan = []
    for path in paths:
        if not path.is_absolute():
            path = (ROOT / path) if not path.exists() else path
        for mutation in json.loads(path.read_text()):
            mutation["plan"] = path.stem
            mutation["id"] = f"{path.stem}/{mutation['id']}"
            plan.append(mutation)
    return plan


def self_test():
    """Check the properties the run's honesty rests on, in both directions.

    Per the 95th pass: a check that can pass vacuously is the hole it was
    written to close. Every loop below asserts it found something to check and
    the count is printed, so a self-test that stopped testing anything says so.
    """
    failures = []
    checks = 0

    def check(description, actual, expected):
        nonlocal checks
        checks += 1
        if actual != expected:
            failures.append(f"{description}: expected {expected!r}, got {actual!r}")

    scratch = ROOT / "scripts" / ".self-test-scratch.txt"
    scratch.write_text("alpha\nbeta\nalpha\n")
    try:
        relative = str(scratch.relative_to(ROOT))
        restore = apply_mutation({"edits": [{"file": relative, "old": "beta", "new": "GAMMA"}]})
        check("a unique pattern is applied", "GAMMA" in scratch.read_text(), True)
        restore()
        check("restore puts the file back", scratch.read_text(), "alpha\nbeta\nalpha\n")

        refusals = 0
        for pattern in ("alpha", "nowhere"):
            try:
                apply_mutation({"edits": [{"file": relative, "old": pattern, "new": "X"}]})
                failures.append(f"an ambiguous or absent pattern {pattern!r} was accepted")
            except RuntimeError:
                refusals += 1
            check(f"the tree is untouched after refusing {pattern!r}",
                  scratch.read_text(), "alpha\nbeta\nalpha\n")
        check("both bad patterns were refused", refusals, 2)

        other = ROOT / "scripts" / ".self-test-scratch-2.txt"
        other.write_text("delta\n")
        try:
            apply_mutation({"edits": [
                {"file": relative, "old": "beta", "new": "GAMMA"},
                {"file": str(other.relative_to(ROOT)), "old": "nowhere", "new": "X"},
            ]})
            failures.append("a half-applicable multi-file mutation was accepted")
        except RuntimeError:
            pass
        check("the first edit was rolled back", scratch.read_text(), "alpha\nbeta\nalpha\n")
        other.unlink()
    finally:
        scratch.unlink(missing_ok=True)

    def result(kind, caught, declared=None, built=True):
        return {
            "id": "p/M", "plan": "p", "kind": kind, "describes": "d",
            "built": built, "caught": caught, "expected_unnoticed": declared,
        }

    check("an undeclared catch is CAUGHT", classify(result("A", True)), "CAUGHT")
    check("an undeclared miss is UNNOTICED", classify(result("A", False)), "UNNOTICED")
    check("a declared miss is EXPECTED-UNNOTICED",
          classify(result("A", False, "masked")), "EXPECTED-UNNOTICED")
    check("a declared CATCH is a stale declaration",
          classify(result("A", True, "masked")), "STALE-DECLARATION")
    check("an undeclared catch needs nobody", problems([result("A", True)]), [])
    check("a declared miss needs nobody", problems([result("A", False, "masked")]), [])
    check("an undeclared miss needs a human", len(problems([result("A", False)])), 1)
    check("a STALE declaration needs a human",
          len(problems([result("A", True, "masked")])), 1)
    check("a control is not counted as a hole", problems([result("control", False)]), [])

    # The verdict this port adds, in both directions. A mutation the compiler
    # rejected must never be reported as a catch: `tsc` is not the suite.
    check("a mutation that did not compile is BUILD-FAILED",
          classify(result("A", None, built=False)), "BUILD-FAILED")
    check("a BUILD-FAILED mutation needs a human",
          len(problems([result("A", None, built=False)])), 1)
    check("a declaration does not excuse a build failure",
          classify(result("A", None, "masked", built=False)), "BUILD-FAILED")
    check("a control that did not compile is still reported",
          len(problems([result("control", None, built=False)])), 1)

    # Controls, both directions, per plan.
    check("a plan with no controls vouches for nothing",
          len(control_problems([result("A", True)])), 1)
    check("a healthy control pair complains about nothing",
          control_problems([
              {**result("control", True), "id": "p/CONTROL-POSITIVE"},
              {**result("control", False), "id": "p/CONTROL-NEGATIVE"},
          ]), [])
    check("an uncaught CONTROL-POSITIVE is a problem",
          len(control_problems([
              {**result("control", False), "id": "p/CONTROL-POSITIVE"},
              {**result("control", False), "id": "p/CONTROL-NEGATIVE"},
          ])), 1)
    check("a caught CONTROL-NEGATIVE is a problem",
          len(control_problems([
              {**result("control", True), "id": "p/CONTROL-POSITIVE"},
              {**result("control", True), "id": "p/CONTROL-NEGATIVE"},
          ])), 1)

    for line in failures:
        print(f"SELF-TEST FAILED: {line}")
    if failures:
        return 1
    print(f"self-test passed: {checks} checks, both directions")
    return 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    plan = load_plans([a for a in sys.argv[1:] if not a.startswith("--")])
    results = []
    for mutation in plan:
        try:
            result = score(mutation)
        except RuntimeError as error:
            result = {
                "id": mutation["id"], "plan": mutation["plan"], "kind": mutation["kind"],
                "describes": mutation["describes"], "built": True, "caught": None,
                "error": str(error),
            }
        results.append(result)
        print(
            f"{LABELS[classify(result)]}  [{result['kind']}] {result['id']}: "
            f"{result['describes']}"
        )
        if result.get("error"):
            print(f"            {result['error'].splitlines()[0]}")
        sys.stdout.flush()

    Path(ROOT / "mutation-results.json").write_text(json.dumps(results, indent=2))

    real = [r for r in results if r["kind"] != "control"]
    tally = {}
    for result in real:
        verdict = classify(result)
        tally[verdict] = tally.get(verdict, 0) + 1
    print(
        f"\n{len(real)} real mutations: "
        + ", ".join(f"{count} {verdict}" for verdict, count in sorted(tally.items()))
    )

    complaints = problems(results) + control_problems(results)
    for line in complaints:
        print(line)
    if not complaints:
        plans = sorted({r["plan"] for r in results})
        print(f"controls behaved in all {len(plans)} plans, and no mechanism is unpinned")

    return 1 if complaints else 0


if __name__ == "__main__":
    sys.exit(main())

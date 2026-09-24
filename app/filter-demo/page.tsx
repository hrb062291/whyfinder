/**
 * /filter-demo — the pitch moment.
 *
 * Runs the same filter over output produced WITH the constraint prompt and with
 * it stripped. Server-rendered from recorded fixtures, so it works with no
 * network, no API key, and no venue wifi.
 */

import { runStripPromptDemo } from '../../src/demo/stripPrompt.js';

export const dynamic = 'force-static';

export default function FilterDemo() {
  const { hardened, stripped } = runStripPromptDemo();
  const rows = [hardened, ...stripped];

  return (
    <main>
      <div className="column" style={{ maxWidth: 760, paddingBlock: '56px 96px' }}>
        <p className="demo-eyebrow">C-15</p>
        <h1 className="demo-h1">The filter does not depend on the prompt</h1>
        <p className="demo-lead">
          Most safety in AI products lives in the system prompt. Ours runs after generation,
          in the request path, with no way to switch it off. Below is the same model with the
          constraint instructions in place, and then with every one of them removed.
        </p>

        {rows.map((row, i) => (
          <section className="demo-row" key={i}>
            <div className={`demo-label ${row.verdict.pass ? 'is-pass' : 'is-block'}`}>
              {row.label}
            </div>
            <p className="demo-quote">&ldquo;{row.body}&rdquo;</p>
            <div className={`demo-verdict ${row.verdict.pass ? 'is-pass' : 'is-block'}`}>
              {row.verdict.pass ? 'Shown to the person' : 'Blocked — never reaches the person'}
            </div>
            {row.verdict.violations.length > 0 && (
              <ul className="demo-violations">
                {row.verdict.violations.map((v, j) => (
                  <li key={j}>
                    <code>{v.constraint}</code> {v.rule}
                    {v.match && <em> &mdash; matched &ldquo;{v.match}&rdquo;</em>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <p className="demo-foot">
          The filter function takes two arguments: the candidate and the person&rsquo;s own stored
          text. It reads no environment variable and accepts no options object, so there is no
          bypass to find. The constraints sit outside the model adapter, which means swapping one
          provider for another changes nothing about what the app is allowed to say.
        </p>
      </div>
    </main>
  );
}

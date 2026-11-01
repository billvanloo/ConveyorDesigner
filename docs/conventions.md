# 00. Shared conventions

Every tool in this package follows these rules. Tool specs only restate a convention when they change it.

## 1. Delivery

- One self-contained HTML file per tool. No external scripts, fonts, images or network calls at run time. It must work opened from disk and when hosted on GitHub Pages or billvanloo.com.
- Target devices: Chromebook, Windows or Mac laptop, full-size tablet. Minimum layout width 1024 px for full function. Below 768 px, show a notice that the tool needs a larger screen, matching the Gear Train Workbench's current behavior, but keep readouts readable.
- Browsers: current Chrome, Edge, Safari, Firefox.
- Keep the calculation core separate from the interface so it can be unit tested in Node without a browser. The core takes plain inputs in SI and returns plain outputs in SI.
- Ship a `dev/` folder with a test runner and every test case in the tool's spec, following the Truss Stress Visualizer's pattern of `dev/test.js` and a check that the inline copy of the solver matches the tested copy.

## 2. Look and feel

- Match the existing tools. A light "drafting paper" theme (ink on pale paper with a faint grid) and a dark "blueprint" theme, switched by a theme button, remembered in the browser. Printed and exported output is always ink on paper.
- Header bar: tool name, a short subtitle, a Sandbox or Challenge mode switch where the tool has challenges, a Name field, and Export image, Report, Save, Load and help buttons.
- Footer: "Designed by Bill Van Loo", the same AI-assistance note the existing tools use, Report a bug and Request a feature mail links with prefilled subjects, Ko-fi link, MIT license link, View source link.
- Help panel opened by the ? button, written for students, with a teacher notes section at the end.

## 3. Units and numbers

- Internal calculations use SI base units: N, m, s, kg, rad, J, W, Pa. Convert at the edges.
- Display units follow the unit plan: N, mm, m, N·m, N·mm where stress is computed, MPa, rpm, rad/s, W, J, °C.
- Where a tool offers US customary display, use these exact definitions: 1 in = 25.4 mm; 1 lb (mass) = 0.45359237 kg; standard gravity for unit definitions g₀ = 9.80665 m/s², so 1 lbf = 4.4482216152605 N; 1 hp (mechanical) = 33,000 ft·lbf/min = 745.70 W; 1 psi = 1 lbf/in².
- For physics calculations use g = 9.81 m/s², matching the unit plan and OpenStax. State this in the help panel.
- 1 N·m = 100 N·cm = 1000 N·mm. 1 MPa = 1 N/mm². rpm to rad/s: multiply by 2π/60.
- Display 3 significant figures by default, with a setting for 4. Never round inside the calculation chain.
- Percent difference is always (predicted − reference) ÷ reference × 100, where reference is the model value unless stated. If the reference is 0, show "not defined" rather than a number.

## 4. Predict first mode

Every tool has a Predict first switch, off by default in Sandbox and on by default in Challenge mode.

1. When on, each designated result shows its label but a blank value, and any on-canvas element that reveals the answer (an operating point dot, a peak label) is hidden.
2. A prediction field appears for each designated result, with its unit shown beside the field.
3. The student presses Check. The tool reveals the results, shows "You predicted X. The model gives Y (Z% difference).", and writes a record to the prediction log (see `07-prediction-log.md`).
4. Changing any input hides the results again and clears the prediction fields. The attempt counter for that problem goes up by one on the next Check.
5. Tolerance bands for a "close" message are set per challenge. Default: within 5% shows "Close", within 1% shows "Match". Never block a student from continuing.
6. A teacher can require a prediction before a Run button works (challenge setting).

## 5. Show the working

Every tool has a collapsible "Show the working" panel under its readout. It lists each calculation step in order as: the formula in symbols, the formula with numbers and units substituted, and the result with units. Each step names its source (short citation such as "OpenStax College Physics 2e, 9.2"). This is how students find where a prediction went wrong, and it should read like a correct hand solution.

## 6. Persistence and export

- Save browser state (name, current build, challenge progress, prediction history) in local storage, with a Clear my data button.
- Save and Load a JSON design file. Include `tool`, `toolVersion`, `schemaVersion`, `savedAt` and the full input state. Loading a file from an older schema version must either migrate it or explain what could not be loaded.
- Export image: PNG of the main drawing at 2× resolution, ink on paper, with a caption strip showing student name, tool, challenge and date.
- Report: a printable page (browser print to PDF) with the drawing, all inputs, all outputs, the show-the-working steps, the prediction history for this session and the sources list.
- File names: `<name>_<tool>_<challenge or sandbox>_<YYYY-MM-DD>.<ext>`, with unsafe characters replaced by hyphens.
- Prediction log export: see `07-prediction-log.md`.

## 7. Accessibility

- Every action is possible from the keyboard. Document keys in the help panel, following the Gear Train Workbench's model.
- Canvas or SVG drawings have a text description that updates as the model changes, announced through a polite live region.
- Respect prefers-reduced-motion by stopping continuous animation while keeping numbers live.
- Color is never the only signal. Tension versus compression, pass versus fail and zone bands also use labels, patterns or icons.
- Contrast at WCAG 2.1 AA in both themes. Visible focus outline on every control.

## 8. Errors and edge cases

- Validate every input on change. Out-of-range or impossible values show a message next to the field that says what is wrong and how to fix it, in the tool's voice. Example: "Diameter must be greater than 0 mm."
- Never show NaN, Infinity or a blank where a number belongs. Show a short reason instead, such as "not defined: load is zero."
- Physically impossible states (a stalled motor, a thread that cannot be driven, a self-locking brake) are results, not errors. Show them in the readout with an explanation.

## 9. Content rules

- Every formula shown to students has a source in the help panel's Sources list. Use the same sources as the unit plan. If a builder needs a formula that is not in the spec, flag it for review instead of adding it.
- Material property presets ship as clearly labeled placeholders that the teacher replaces with measured or datasheet values, following the Truss Stress Visualizer's approach. The interface says when a placeholder value is in use.
- Copy is plain, sentence case, active voice. No exclamation marks in results.

## 10. Test tolerance

Unless a test case says otherwise, numeric results must match expected values within 0.5% relative, or within 0.01 in the displayed unit for values under 1.

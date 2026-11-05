We need to build a **persistent Interactive Playwright Click Recorder** as part of the SGAP automation framework.

The purpose of this tool is to help the AI/automation engineer when it cannot reliably locate a UI element, does not know the correct locator, or becomes stuck in a new or unfamiliar game scenario.

This is a **support and discovery tool**, not a replacement for the automation framework.

---

## 1. Core Purpose

Create a recorder that allows a QA Engineer to manually demonstrate interactions to the automation.

The recorder should:

* Open in a separate browser window/page.
* Display the currently running game.
* Allow the QA Engineer to manually click elements.
* Record each click.
* Display recorded clicks visually.
* Display recorded click information in the terminal.
* Allow the QA Engineer to confirm, skip, close, or revert recorded actions.
* Remain available throughout the automation development process.

The goal is:

**Human demonstrates → Recorder captures → AI analyzes → AI creates a reliable Playwright implementation.**

---

## 2. Recorder Controls

The recorder must provide the following controls:

### Confirm

Confirms the currently recorded interaction sequence.

When confirmed:

* Preserve the recorded clicks.
* Output the recorded interaction information.
* Make the information available to the AI/automation workflow.
* Do not remove the recorded actions.

### Skip

Ignore the currently selected/latest recorded interaction.

The skipped click should not be included in the final generated interaction sequence.

### Accept

Accept the current recorded interaction and continue recording.

This should allow the QA Engineer to gradually construct a sequence without ending the recording session.

### Close

Close the recorder interface.

Closing the recorder should NOT automatically delete previously recorded interactions unless explicitly requested.

### Revert Last

Remove only the most recently recorded click.

Example:

```text
Recorded:
1. Click Spin
2. Click Turbo
3. Click Menu

Revert Last

Result:
1. Click Spin
2. Click Turbo
```

### Revert All

IMPORTANT:

"Revert All" means:

**Remove all clicks recorded during the current recording session.**

It does NOT mean:

* Remove existing automation code.
* Delete existing tests.
* Remove existing locators.
* Reset the game.
* Undo all actions performed inside the game.
* Delete previously saved recordings.

It only clears the **recent recorded click history**.

---

## 3. Visual Click Recording

Every recorded click should be visually identifiable.

When the QA Engineer clicks an element:

* Display a marker at the click location.
* Give each click a sequential number.
* Keep the markers visible until the interaction is reverted.
* Use different visual states for:

  * Active
  * Accepted
  * Skipped
  * Reverted

Example:

```text
        [Spin Button]

             ● 1
             ↓

Recorded Click #1
```

The recorder must support coordinate-based recording because some game elements are rendered through Canvas/WebGL and may not have useful DOM selectors.

---

## 4. Terminal Output

Every recorded click must also be printed to the terminal.

Example:

```text
[RECORDER] Click #1
[RECORDER] Page: Game
[RECORDER] Frame: Game iframe
[RECORDER] Coordinates: x=163, y=534
[RECORDER] Element: Spin Button
[RECORDER] Selector: <detected selector if available>
[RECORDER] Timestamp: 2026-08-13T17:30:21
```

If Playwright can identify a reliable DOM locator, record it.

If no reliable locator exists, record the coordinates.

The recorder should attempt to capture as much useful information as possible:

* Page
* Frame
* Coordinates
* DOM element
* Tag name
* Attributes
* Text
* Role
* Locator candidates
* Bounding box
* Timestamp
* Current game state if available

---

## 5. Locator Discovery

The recorder should attempt to determine the best automation strategy for each click.

Priority:

1. Reliable semantic locator
2. Stable DOM locator
3. Role-based locator
4. Text-based locator
5. Attribute-based locator
6. Element coordinates
7. Canvas coordinates

Do NOT automatically assume that coordinates are the preferred solution.

Coordinates should be the fallback when the game is Canvas/WebGL based or when a reliable DOM locator cannot be identified.

---

## 6. iframe Support

The games are iframe-based.

There is only one game iframe.

The iframe selector is consistent across games, while the `src` changes depending on the game.

The recorder must therefore:

* Detect the game iframe.
* Attach to the correct iframe.
* Record interactions inside the iframe.
* Distinguish interactions inside the iframe from interactions on the casino lobby page.

Do not create provider-specific iframe logic unless technically necessary.

---

## 7. Canvas / WebGL Support

The game uses Phaser and may render using:

* WebGL
* Canvas fallback

Some game controls exist as DOM elements, while game visuals may exist inside Canvas/WebGL.

The recorder must support both situations.

If the clicked object is a DOM element:

Record its locator information.

If the click occurs on Canvas/WebGL:

Record the coordinates relative to the appropriate game surface.

Do not assume every visible game object has a DOM locator.

---

## 8. Invisible Overlay / Loading Panel Handling

Some games may contain an element similar to:

```html
<div class="_loading_jo7fi_1"></div>
```

This element may behave like an invisible overlay or interaction barrier.

The recorder must detect whether an invisible element is intercepting the click.

If detected, report it:

```text
[RECORDER] Possible interaction overlay detected.
[RECORDER] Element: div._loading_jo7fi_1
[RECORDER] Visibility: hidden/transparent
[RECORDER] Click interception: possible
```

Do NOT automatically remove or modify the element.

The recorder should only report it and allow the automation engineer to determine the appropriate solution.

---

## 9. Recorder Persistence

The recorder should remain available throughout automation development.

It should not be a one-time utility.

The AI should be able to request its use whenever:

* A locator cannot be identified.
* A click target is ambiguous.
* A Canvas/WebGL element cannot be located.
* The automation becomes stuck.
* A new game introduces unfamiliar UI behavior.
* A new package introduces unfamiliar controls.
* The AI needs a human demonstration.

---

## 10. AI Interaction Workflow

When the AI encounters a problem locating or interacting with an element, it should NOT immediately create a fragile locator.

Instead, the AI should be able to say:

```text
I cannot reliably identify the target interaction.

Please open the SGAP Click Recorder and demonstrate the interaction once.

After you perform the interaction, click Confirm.
```

The AI should then analyze the recorder output and determine the most reliable automation method.

---

## 11. Example Workflow

### Scenario

The AI cannot locate the Spin button.

AI:

```text
Unable to identify a reliable Spin Button locator.

Please demonstrate one Spin Button click using the Click Recorder.
Click Confirm after the interaction.
```

QA Engineer:

```text
Clicks Spin.
Clicks Confirm.
```

Recorder:

```text
[RECORDER] Click #1
Frame: Game iframe
Coordinates: x=163, y=534
DOM locator: unavailable
Canvas interaction: detected
```

AI:

```text
The Spin Button is rendered through the game surface.

I will evaluate whether the coordinate is stable enough for automation.
If it is not stable, I will investigate another observable or locator strategy.
```

---

## 12. Important Rule: Recording Is Not Automation

The recorder must NEVER automatically convert every click into permanent automation code.

The workflow should be:

```text
Human Interaction
       ↓
Recorder
       ↓
Recorded Evidence
       ↓
AI Analysis
       ↓
Locator / Interaction Strategy
       ↓
QA Review
       ↓
Automation Code
```

This prevents the recorder from introducing unreliable locators into the framework.

---

## 13. Recovery and Re-recording

The QA Engineer must be able to experiment freely.

Example:

```text
Click #1
Click #2
Click #3

Revert Last

Click #3 again

Click #4

Confirm
```

The final accepted sequence should contain only the intended interactions.

The recorder should maintain a clear history of:

* Recorded
* Accepted
* Skipped
* Reverted

---

## 14. Engineering Requirements

The implementation must:

* Use TypeScript.
* Use Playwright.
* Follow SGAP architecture.
* Be reusable.
* Avoid game-specific logic.
* Avoid provider-specific logic.
* Avoid hardcoded game behavior.
* Support iframe interactions.
* Support Canvas/WebGL coordinate recording.
* Provide clear terminal logging.
* Provide clear visual feedback.
* Be maintainable.

Do not introduce this recorder directly into existing test cases.

Treat it as a reusable **SGAP Developer/QA Tool**.

---

## 15. Before Implementation

Before writing code:

1. Read:

   * `AI_PROJECT_CONTEXT.md`
   * `SGAP_PROJECT_HISTORY.md`
   * `SGAP_ENGINEERING_HANDBOOK.md`

2. Inspect the existing Playwright architecture.

3. Determine where the recorder belongs.

4. Explain the proposed architecture.

5. Explain how the recorder communicates its captured information to the automation workflow.

6. Explain how iframe and Canvas/WebGL clicks will be captured.

7. Explain how the recorder remains persistent and reusable.

8. Identify any technical limitations.

9. Only then implement it.

Do not rewrite existing architecture unnecessarily.

---

## 16. Success Criteria

The recorder is considered successful when:

* A QA Engineer can open it alongside the game.
* A click can be recorded.
* The click is visibly marked.
* The click appears in the terminal.
* DOM locator information is captured when available.
* Canvas/WebGL coordinates are captured when necessary.
* `Confirm` preserves the sequence.
* `Skip` ignores the selected interaction.
* `Revert Last` removes only the latest recorded click.
* `Revert All` clears only the current recording session.
* The recorder can operate inside the game's iframe.
* Invisible interaction overlays can be detected and reported.
* The AI can use the captured information to determine an automation strategy.
* Existing tests and automation are not modified automatically.

---

## Final Requirement

Do not build this as a temporary debugging script.

Build it as a permanent SGAP tooling component that can evolve alongside the automation framework.

The primary objective is to create a reliable bridge between:

**Human QA knowledge → Playwright evidence → AI-assisted automation.**

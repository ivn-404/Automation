## Loading Screen

- Max Win
  - Max Win value should not be hardcoded.
- Loading Spin Button
  - Should only be clickable when Initialize has been called. Should not activate when an Initialize pop-up error occurs.
  - Should not be triggered by the Spacebar.

## Slot Controller

### Spin Button

- Should not trigger a double-spin.
- Spin Button should deduct the selected amount.
- Disable all gameplay controls, this includes in-game modal pop-ups while a spin is in progress or while the Spin button is being spammed:

Buttons:

- Buy Feature
- Bet Modal & +/- Controls
- Autoplay
- Amplify Bet
- Turbo Mode

&#x9;	Modals:

- Session Timeout
- Insufficient Balance
- Offline
- Initialize
- Bet Failed




* Menu/Help Screen should remain accessible during gameplay.
* Clicking the button many times will trigger a skip effect.

### Autoplay

- Auto Play should execute the exact number of selected spins.
- Autoplay should deduct the selected amount.
- Disable all gameplay controls instantly while the Auto Play modal appears and while Auto Play is executed.
  - Buy Feature
  - Bet Modal & +/- Controls
  - Amplify Bet
  - Turbo Mode
- Clicking the **Spin** button while **Auto Play** is active should immediately stop Auto Play.
- Clicking the **Auto Play** button again while **Auto Play** is active should also stop Auto Play.
- Auto Play should not stop while space spamming; it should only skip the spins.
- Menu/Help Screen should remain accessible during gameplay.

Buy Feature

- Buy Feature should not produce double buy.
- Buy Feature should deduct the selected amount.
- Buy Feature bet value in the modal should be adjustable. 
- Buy Feature should execute the expected number of free spins.
- Buy Feature button should be disabled when Amplify Bet is active.
- Disable all gameplay controls instantly while the Buy Feature modal appears and while Buy Feature is executed.
  - Autoplay
  - Spin Button
  - Bet Modal & +/- Controls
  - Amplify Bet
  - Turbo Mode
- Transitioning back to Normal Mode should prevent immediate button/controller triggers.

### Buy Feature (Other Package Features)

- Buy Feature should deduct the selected feature amount.
- Buy Feature should apply the corresponding multiplier.
- Buy Feature should apply the selected number of Scatter symbols.

### Amplify Bet

- Amplify Bet should increase the wager by **25%**, and the value displayed in the UI and modal should be accurate.
- When Amplify Bet is enabled, Buy Feature should be disabled.
- Amplify Bet should not affect the payout values displayed in the Help Screen.

Turbo

- Turbo Mode should be spam-proof and retain only the last selected state.
- Turbo Mode should only increase the speed of spin animations and reel drops while keeping both animations synchronized.
- Turbo Mode should be functional in both **Normal** and **Bonus** mode.

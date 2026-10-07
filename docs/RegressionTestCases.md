/**************************************************************************************************
 * NOTE:
 * - The QA Team is the sole authority permitted to modify, add, remove, or update these test cases.
 * - Do not edit, rename, reorder, or delete any test case without QA approval.
 * - These test cases are considered the source of truth for both Manual and Automation Testing.
 * - Test cases may be updated in future releases as new features, bug fixes, or requirements are introduced.
 * - Always review the latest version before creating or maintaining automation scripts.
 **************************************************************************************************/

CSF - Core Spin Flow
CSF-001 - Spin button clickable in Idle state
CSF-002 - No double spin triggered on rapid click / Space
CSF-003 - Bet deducted immediately upon spin
CSF-004 - Reels stop correctly (No stuck reel)
CSF-005 - Balance updates correctly after win
CSF-006 - Result shown after reel stop [Manual]
CSF-007 - Total Win displays correctly
CSF-008 - No Win scenario works correctly
CSF-009 - Max Win single spin implementation [Manual]
CSF-010 - Max Win single spin animation [Manual]
CSF-011 - Normal mode multiplier ["Package 2, Package 3, Package 5, Package 6, Package 7, Package 8, Package 11 This are the packages that only has multiplier in the normal modes. Please see this file for the games ALL_GAMES.MD"]
CSF-012 - Skip function via Space

AT - Additional Test
AT-001 - Misleading payout guides on Help Screen 
AT-002 - Currency should display the appropriate currency symbol instead of the currency code or name.
AT-003 - No refund handler
AT-004 - Multiple sessions should not be allowed on one account
AT-005 - Buy Feature unavailable during multiple sessions 
AT-006 - Spin continuation after refreshed Free Spin session
AT-007 - Scroll and page orientation
AT-008 - Controller functionality
AT-009 - Balance matches after Buy Bonus
AT-010 - Buy Feature force resolve

BC - Bet Control
BC-001 - Bet (+) increases correctly
BC-002 - Bet (-) decreases correctly
BC-003 - Bet cannot go below minimum
BC-004 - Bet cannot exceed maximum
BC-005 - Bet locked during spin(s)
BC-006 - Bet value matches backend request
BC-007 - Currency formatting correct (KRW, USD, TND, etc.)

BF - Buy Feature
BF-001 - Buy amount recalculates when bet changes
BF-002 - Buy amount matches expected multiplier
BF-003 - Buy disabled during spin
BF-004 - Buy disabled if insufficient balance
BF-005 - Buy disabled when Amplify is enabled
BF-006 - Buy deducts correct amount
BF-007 - Buy triggers correct feature
BF-008 - Game remains in Idle state during Buy Feature win dialogue
BF-009 - Max Win animation during Buy Feature [Manual]
BF-010 - No balance mismatch after Buy Feature

AP - Autoplay
AP-001 - Autoplay starts correctly
AP-002 - Autoplay runs selected number of spins
AP-003 - Autoplay stops when manually stopped
AP-004 - Autoplay stops on insufficient balance
AP-005 - Autoplay respects Turbo Mode
AP-006 - Autoplay continues when Scatter triggers
AP-007 - Autoplay continues after Max Win (when Max Win cap is low) [Manual]
AP-008 - Autoplay credits balance after Scatter
AP-009 - Autoplay disables Amplify, Bet, and Buy Feature
AP-010 - Returns to Autoplay after retrigger

TM - Turbo Mode
TM-001 - Turbo toggle works
TM-002 - Reel speed increases in Turbo Mode
TM-003 - Turbo persists during Autoplay
TM-004 - Turbo does not break Win Dialogue animation logic

FS - Feature / Free Spins (Located at the game columns, it's like a gift icon and always set the free spin grant to 10 only and bet size of 10 when running this FREE SPIN TEST CASE)
FS-001 - Scatter triggers Feature correctly
FS-002 - Free Spins count displayed correctly (Auto = 0 after Max Win)
FS-003 - No bet deduction during Free Spins
FS-004 - Wins accumulate correctly
FS-005 - Multiplier applies correctly
FS-006 - Feature exits back to Base Game correctly
FS-007 - Game state resets correctly after Feature
FS-008 - Scatter retriggers correctly during Feature
FS-009 - Refreshed session winnings match Spin Data

UIDS - UI & Display Sync
UIDS-001 - Max Win text displayed [Manual]
UIDS-002 - Help Screen and Launch Screen display identical Max Win text [Manual]
UIDS-003 - Bet display matches internal value [Meaning: Bet in-game should match the payloads network "bet"] 
UIDS-004 - Buy display matches calculated value [Meaning: You still have to base your value thru "bet" in payload before you could match it in the buy feature amount. This can differ in every different package. Ex. In package 1 the bet is 0.20 and the feature value should be 20.00]
UIDS-005 - Total Win matches server response [Meaning: The total win in visual should match the payloads response "totalWin"]
UIDS-006 - Balance matches server response [ 
If freespin or bonus has items:
 - balance in payload not updated
 - FE balance = payload balance + total win
If no freespin or bonus items:
 - balance in payload is updated with any winnings on that spin
 - Balance = payload balance]
UIDS-007 - No delayed or incorrect Win animation [Manual]
UIDS-008 - No animation discrepancies [Manual]
UIDS-009 - Winning line animation displays correctly [Manual]
UIDS-010 - No overlapping UI elements [Manual]
UIDS-011 - Drop speed displays correctly [Manual]
UIDS-012 - History matches backend records [Meaning: Your current spin or buy features must be properly recorded real-time in the history, must follow the time and date.]

AS - Audio & Settings
AS-001 - Spin sound plays correctly [Manual]
AS-002 - Win sound plays correctly [Manual]
AS-003 - Feature sound plays correctly [Manual]
AS-004 - Background Music toggle works [Manual]
AS-005 - Sound Effects toggle works [Manual]
AS-006 - BGM and SFX volume sliders work correctly [Manual]
AS-007 - Opening Menu does not re-enable disabled sounds [Manual]
AS-008 - Background Music stops when browser tab is inactive [Manual]
AS-009 - Sound Effects stop when browser tab is inactive [Manual]

SM - State Management
SM-001 - Cannot Spin during Feature intro animation 
SM-002 - Cannot change Bet during Spin [Meaning: The bet modal must not be accessible so if the automation spins or initiates spin the bet should not be clickable, but if its clickable test must turn fail]
SM-003 - Cannot Buy Feature during Autoplay [Meaning: The Buy Feature button must not be accessible so if the automation spins or initiates spin the Buy Feature button should not be clickable, but if its clickable test must turn fail] 
SM-004 - Game returns to Idle state after Spin [Meaning: The game must correctly behave after spinning once, or when transitioning back to Bonus mode to Normal mode]
SM-005 - No freeze after Big Win [Meaning: No Asset should freeze or Produce a console error. The game should still be playable even after getting a Win Dialogues "Big Win"]
SM-006 - No infinite loading state [Meaning: The game should not remain loading the asset should properly loads and must be seen in the reel table, so exepected output, no unloaded assets.]

ES - Edge & Stability
ES-001 - Initialize error handling
ES-002 - Loading screen font is not italic [Manual]
ES-003 - Rapid-click stress test (Spin, Buy, Bet, Home Screen, Expand)
ES-004 - Bonus skip function via click
ES-005 - Low balance edge case
ES-006 - Maximum bet edge case
ES-007 - Max Win cap logic works
ES-008 - Max Win message displays correctly
ES-009 - Network delay handling
ES-010 - Game recovery after refresh
ES-011 - No console errors during gameplay
ES-012 - Screen orientation handling
ES-013 - Help Screen validation
ES-014 - Object Pooling validation [Manual]

CP - Currency Precision
CP-001 - UI displays 2 decimal places
CP-002 - History and Balance display 2 decimal places

WD - Wilds (Games Applicable: Oppals & Amazonians: Package 7, King In Gold & Joker Ace: Package 11)
WD-001 - Random Multiplier explodes and clears surrounding symbols when no further wins are possible [Manual]
WD-002 - Double Wild functionality [Manual]
WD-003 - Single Wild functionality [Manual]

Scratch Game 22 (ALL SLOT GAMES)
SCG-001 Button is existing and clickable
SCG-002 Scratch Card Panel (MAIN CANVAS & OUTSIDE MAIN CANVAS)
SCG-003 Bet + increases correctly
SCG-004 Bet – decreases correctly
SCG-005 Bet locked during scratching
SCG-006 Bet value matches backend request
SCG-007 Bet currency is same with the slot bet currency
SCG-008 Dimension selection is existing and clickable
SCG-009 Clicking 3x3 size change the scratch dimension 
SCG-010 Clicking 4x4 size change the scratch dimension 
SCG-011 Clicking 5x5 size change the scratch dimension 
SCG-012 Legends exist for 3x3
SCG-013 Legends exist for 4x4
SCG-014 Legends exist for 5x5
SCG-015 Base bet on 3x3 dimension cannot go below minimum
SCG-016 Base bet on 4x4 dimension cannot go below minimum
SCG-017 Base bet on 5x5 dimension cannot go below minimum
SCG-018 Cannot scratch upon launching panel
SCG-019 Buy Card button
SCG-020 Scratch all button
SCG-021 Can scratch manually
SCG-022 Win can only have three or more symbols
SCG-023 Total win 
SCG-024 The scratch card background should be consistent with the Buy Feature background of the same slot game.
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
CSF-003 - Bet deducted immediately upon Spin
CSF-004 - Reels stop correctly (No stuck reel)
CSF-005 - Balance updates correctly after Win
CSF-006 - Result shown after reel stop
CSF-007 - Total Win displays correctly
CSF-008 - No Win scenario works correctly
CSF-009 - Max Win single spin implementation
CSF-010 - Normal mode multiplier
CSF-011 - Skip function via Space

AT - Additional Test
AT-001 - Misleading payout guides on Help Screen
AT-002 - Currency should display ZAR instead of R
AT-003 - No refund handler
AT-004 - Cannot create multiple sessions on one account
AT-005 - Cannot use Buy Feature during multiple sessions on one account
AT-006 - Spin continuation after refreshed Free Spin session
AT-007 - Scroll and page orientation
AT-008 - Controller validation
AT-009 - Balance matches after Buy Bonus
AT-010 - Buy Feature force resolve

BC - Bet Control
BC-001 - Bet (+) increases correctly
BC-002 - Bet (-) decreases correctly
BC-003 - Bet cannot go below minimum
BC-004 - Bet cannot exceed maximum
BC-005 - Bet locked during Spin(s)
BC-006 - Bet value matches backend request
BC-007 - Currency formatting correct (KRW, USD, TND, etc.)

BF - Buy Feature
BF-001 - Buy amount recalculates when bet changes
BF-002 - Buy amount matches expected multiplier
BF-003 - Buy disabled during Spin
BF-004 - Buy disabled if insufficient balance
BF-005 - Buy disabled when Amplify is enabled
BF-006 - Buy deducts correct amount
BF-007 - Buy triggers correct Feature
BF-008 - Game remains in Idle state during Feature Win dialogue
BF-009 - No balance mismatch after Buy Feature

AP - Autoplay
AP-001 - Autoplay starts correctly
AP-002 - Autoplay runs selected number of Spins
AP-003 - Autoplay stops when manually stopped
AP-004 - Autoplay stops on insufficient balance
AP-005 - Autoplay respects Turbo Mode
AP-006 - Autoplay continues when Scatter triggers
AP-007 - Autoplay continues after Max Win (when Max Win cap is low)
AP-008 - Autoplay credits balance after Scatter
AP-009 - Autoplay disables Amplify, Bet, and Buy Feature
AP-010 - Returns to Autoplay after Free Spins

TM - Turbo Mode
TM-001 - Turbo toggle works
TM-002 - Reel speed increases in Turbo Mode
TM-003 - Turbo persists during Autoplay
TM-004 - Turbo does not break Win Dialogue animation logic

FS - Feature / Free Spins
FS-001 - Scatter triggers Feature correctly
FS-002 - Free Spins count displayed correctly (Auto = 0 after Max Win)
FS-003 - No bet deduction during Free Spins
FS-004 - Wins accumulate correctly
FS-005 - Multiplier applies correctly
FS-006 - Feature exits back to Base Game correctly
FS-007 - Game state resets correctly after Feature
FS-008 - Scatter retriggers correctly during Feature

UIDS - UI & Display Sync
UIDS-001 - Help Screen and Launch Screen display "Win up to 2100x"
UIDS-002 - Bet display matches internal value
UIDS-003 - Buy display matches calculated value
UIDS-004 - Total Win matches server response
UIDS-005 - Balance matches server response
UIDS-006 - No delayed or incorrect Win animation
UIDS-007 - No animation discrepancies
UIDS-008 - Winning line animation displays correctly
UIDS-009 - No overlapping UI elements
UIDS-010 - Drop speeds display correctly

AS - Audio & Settings
AS-001 - Spin sound plays correctly
AS-002 - Win sound plays correctly
AS-003 - Feature sound plays correctly
AS-004 - Background Music toggle works
AS-005 - Sound Effects toggle works
AS-006 - BGM and SFX volume sliders work correctly
AS-007 - Opening Menu does not re-enable disabled sounds
AS-008 - Background Music stops when browser tab is inactive
AS-009 - Sound Effects stop when browser tab is inactive

SM - State Management
SM-001 - Cannot Spin during Feature intro animation
SM-002 - Cannot change Bet during Spin
SM-003 - Cannot Buy during Autoplay (if restricted)
SM-004 - Game returns to Idle state after Spin
SM-005 - No freeze after Big Win
SM-006 - No infinite loading state
SM-007 - Failed Bet refunds wagered amount back to balance

ES - Edge & Stability
ES-001 - Loading screen font is not italic
ES-002 - Rapid-click stress test (Spin, Buy, Bet, Home Screen, Expand)
ES-003 - Bonus skip function via click
ES-004 - Low balance edge case
ES-005 - Maximum bet edge case
ES-006 - Max Win cap logic works
ES-007 - Max Win message displays correctly
ES-008 - Network delay handling
ES-009 - Game recovery after refresh
ES-010 - No console errors during gameplay
ES-011 - Screen orientation handling
ES-012 - Help Screen validation
ES-013 - Object Pooling validation

CP - Currency Precision
CP-001 - UI displays 2 decimal places
CP-002 - History and Balance display 2 decimal places
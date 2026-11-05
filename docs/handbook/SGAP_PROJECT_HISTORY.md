# SGAP_PROJECT_HISTORY.md

# Complete Project Context (Conversation Summary)

> This document captures the architectural decisions, philosophy, and agreements made during the planning of the Slot Game Automation Platform (SGAP). It is intended to onboard AI assistants (Cursor, VS Code Chat, ChatGPT, Copilot, Claude, Gemini, etc.) and engineers.

---

# Project Overview

The project is a professional QA Automation Framework for iframe-based Phaser slot games using Playwright and TypeScript.

Goals:

- Build a scalable automation platform.
- Support 21+ games with more to come.
- Minimize duplicated logic.
- Be documentation-first.
- Be AI-assisted but never AI-dependent.

---

# Technology Stack

- Language: TypeScript
- Framework: Playwright
- IDE: VS Code
- AI: Cursor / VS Code Chat / ChatGPT
- Engine: Phaser
- Rendering: WebGL with Canvas fallback
- Game Host: iframe

---

# Framework Philosophy

Architecture before code.

Documentation before implementation.

Build Once, Reuse Everywhere.

Configuration over duplication.

Observable synchronization instead of fixed waits.

Manual QA defines behavior.

Automation executes behavior.

---

# QA Philosophy

Google Sheets is the source of truth for manual test cases.

Manual test cases describe scenarios and expected behavior.

Automation executes scenarios through controllers.

Controllers are not test cases.

Automation reports back to the original test IDs.

---

# Controller Model

Controllers:
- Spin
- Autoplay
- Buy Feature
- Bet
- Amplify Bet
- Turbo
- Menu
- Settings
- Fullscreen

Game Events:
- Initialize
- Offline
- Reconnect
- Session Timeout
- Bet Failed
- Bonus Start
- Bonus End
- Max Win

Data Sources:
- Bet response
- Balance
- History
- Session
- Wallet

Verification:
- Balance
- Bet
- Controller Lock
- Win
- Free Spins
- UI synchronization

---

# Test Categories

CSF - Core Spin Flow
AT - Additional Test
BC - Bet Control
BF - Buy Feature
AP - Autoplay
TM - Turbo Mode
FS - Feature / Free Spins
UIDS - UI & Display Sync
AS - Audio & Settings
SM - State Management
ES - Edge & Stability
CP - Currency Precision

Example IDs:
CSF-001
BF-003
AP-007

---

# Reporting Strategy

Outputs:
- Playwright HTML Report
- JSON Summary
- Traceability Matrix
- Google Sheet Execution Report

The original Google Sheet is never overwritten. Automation publishes execution results separately.

---

# Traceability

Every automated test maps back to exactly one manual test case.

Manual Test Case -> Automation -> Report -> Traceability Matrix

---

# Automation Execution Flow

Manual Test Case
-> Controller
-> Game
-> Game Event (if applicable)
-> Data Sources
-> Verification
-> Execution Tracker
-> Reports

---

# AI Philosophy

AI is an assistant, not a replacement.

AI may:
- Explain
- Analyze
- Recommend
- Generate code
- Review architecture

AI may not:
- Rewrite architecture without approval
- Introduce duplicate components
- Depend on fixed waits
- Become a framework dependency

Modes:
- Read Mode
- Design Mode
- Implementation Mode

---

# SGAP Knowledge System

The project uses a documentation-first knowledge system.

Every document contains:
- Guidance for QA Engineers
- Guidance for AI
- Metadata
- Version
- Revision history

---

# Documentation Rules

Every document:
- Has one responsibility.
- Uses a common template.
- Is versioned.
- Is reviewed before implementation.

---

# Engineering Promise

- Think long-term.
- Protect architecture.
- Reuse components.
- Challenge technical debt.
- Respect QA workflow.
- Keep AI as augmentation only.

---

# Reserved Future

Future AI Intelligence Layer:
- Failure analysis
- Pattern detection
- Coverage advice
- Locator advice
- Learning from observations only

Not autonomous.

---

# Current Status

Milestone 0: Complete

Next:
1. Build SGAP Knowledge System
2. Manual-to-Automation Mapping
3. Framework Architecture
4. Implementation
5. Reporting
6. Reserved AI Layer

---

# Important Decisions Already Made

Accepted:
- Playwright
- TypeScript
- VS Code
- Google Sheets as source of truth
- Traceability Matrix
- Execution Tracker
- Build Once, Reuse Everywhere
- AI Augmentation, Not Dependency

Rejected:
- AI-dependent framework
- Hardcoded waits
- Duplicate controllers
- Package-specific framework logic
- Autonomous AI modifications



# STEMMate Namibia — System Context

## Purpose
STEMMate Namibia is an offline-first STEM activity planning system designed to support facilitators working with limited internet connectivity and shared or low-specification devices.

## Primary User
STEM Facilitator — searches for activities, creates session plans, saves work locally and synchronises plans when connectivity becomes available.

## Supporting Stakeholder
Outreach Coordinator — uses synchronised planning information for coordination without requiring identifiable learner data.

## System Boundary
The STEMMate system provides:
- STEM activity browsing and filtering.
- Session plan creation and validation.
- Local draft persistence.
- Synchronisation and retry handling.
- Visible offline and synchronisation status.

## External Dependencies
- Browser and device storage for local data.
- Network connectivity when synchronisation is available.
- Backend service for receiving and storing synchronised plans.

## Design Constraints
- Intermittent or costly internet connectivity.
- Shared and low-specification devices.
- Accessibility and clear error feedback.
- Minimal collection of personal information.
- Simple maintenance and recovery.

## A4 Requirements Traceability
- FR-03: Create and edit session plans.
- FR-04: Preserve interrupted drafts.
- FR-05: Synchronise plans when connectivity returns.
- FR-06: Display synchronisation and recovery status.
- QR-01: Support accessible interaction.
- SUS-01: Minimise resource usage.

## Scope Note
This document describes the intended system context. Implementation details must be verified against the current repository.

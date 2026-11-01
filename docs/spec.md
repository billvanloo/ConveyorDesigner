# 05. Conveyor Designer

New tool. The capstone integrator for unit module 5. Mockup: `mockups/05-conveyor-designer.html`. Prototype: the conveyor drive sizing interactive on the unit plan page. Reuses the models in files 01 (shaft check) and 02 (motor), and exchanges data with the Gear Train Workbench (file 08).

## 1. Purpose

Teams enter their capstone requirements, then step through the design in the same order as the unit's design process: requirements, belt pull, power, pulley, motor and ratio, belt tensions and slip, pulley shaft, bearings. Every requirement shows pass or fail as the numbers change. The tool produces a design record that serves as the calculation package for the capstone.

### Learning targets

Students can:

1. Turn a brief into numbered, measurable requirements.
2. Compute belt pull for a slider-bed conveyor, including lift.
3. Compute drive power and apply a service factor.
4. Size the drive pulley's speed and torque from belt speed and pull.
5. Pick a motor and ratio using the loaded speed.
6. Check belt slip with the capstan equation and find the minimum slack-side tension.
7. Find the side load on the pulley shaft and check the shaft.
8. Explain which requirements drive which design choices.

## 2. Scope

In version 1: level or inclined slider-bed conveyor carrying discrete boxes, one drive pulley and one tail pulley of equal diameter, a single motor and gearbox, a pulley shaft between two bearings with the pulley centered, and the design record.

Not in version 1: roller-bed or troughed bulk conveyors (CEMA method), multiple drives, snub pulleys, acceleration forces at start-up, belt selection by strength rating. The help panel names these as what industrial design adds (Rulmeca).

## 3. Model and math

### 3.1 Load and throughput

- Product mass per meter of belt: m′_p = m_box / s.
- Throughput: 60 v / s boxes per minute.
- Boxes on the belt at once: floor(L / s) + 1 at most (display as a range if spacing does not divide L).

### 3.2 Belt pull (effective tension)

- T_e = μ g (m′_b + m′_p) L + m′_p g H.
- This is PackagingConveyor.com's slider-bed formula T_e = F·L·(W_b + W_p) + W_p·H, rewritten in SI with masses per meter of belt and g = 9.81 m/s². Friction factors from that source: 0.03 to 0.06 on UHMW, 0.15 to 0.30 on steel without UHMW. The tool asks students to measure μ with the ramp method (file 03) and shows these as reference ranges only.
- L is belt length on the bed; H is lift. H must not exceed L. Incline angle shown is arcsin(H/L).
- The friction term uses full weight, which slightly overestimates friction on an incline. Help text says this is on the safe side.
- Belt pull does not depend on speed (PackagingConveyor.com). Show this explicitly in help.

### 3.3 Power

- Belt power P = T_e v (Rulmeca).
- Motor power needed = P × service factor ÷ drive efficiency. Default service factor 1.5, normal duty, adjustable 1.0 to 3.0 (PackagingConveyor.com gives 1.5 normal, 2.0 heavy, 2.5 to 3.0 severe).

### 3.4 Drive pulley

- Pulley torque T_p = T_e D / 2.
- Pulley speed N_p = 60 v / (π D) rpm, from v = ω r.

### 3.5 Motor and ratio

Embed the Motor and Drive Matcher model (file 02, sections 3.1 to 3.4) with load T_L = T_p and target N_out = N_p. Show the operating point, duty band and both ratio roots. Also accept a hand-entered ratio and show the resulting belt speed and its error against the target speed. A "Build this in the Gear Train Workbench" button exports a drive request (file 02 section 5).

### 3.6 Tensions and slip

- T₁ = T_e + T₂ (Rulmeca).
- Slip limit (capstan, Euler-Eytelwein): T₁ / T₂ ≤ e^(μ_p θ), wrap angle θ in radians (Wikipedia, capstan equation). Maximum transmissible pull T_e,max = T₂ (e^(μ_p θ) − 1) (BisonConvey).
- Minimum slack-side tension: T₂,min = T_e / (e^(μ_p θ) − 1). Students set their actual T₂ (belt tension setting) at or above this; default T₂ = T₂,min × 1.3, labeled "your belt tension setting."
- Default wrap θ = 180° for equal pulleys. Allow 90° to 270°.

### 3.7 Pulley shaft side load and check

- Resultant of the two belt spans on the pulley: R = √(T₁² + T₂² − 2 T₁ T₂ cos θ). For θ = 180° this is T₁ + T₂. This is vector addition of the two span tensions, whose directions differ by (180° − θ).
- Shaft check: pulley centered between bearings with span L_b. M = R L_b / 4. Torque T_p. Use the Tresca check from file 01 section 3.4 with d and Sy entered by the team. Export the load as a shaft-loads file for the full Shaft and Beam Workbench.
- Bearing loads: R / 2 each for a centered pulley.

### 3.8 Hold on an incline

When H > 0, show a flag: "On an incline the load can drive the belt backward when power is off. Check whether your motor and gearbox hold, or add a brake or holding feature." Report the backward pull from gravity, m′_p g H.

## 4. Requirements sheet

A table the team fills in first. Each row: ID, description, quantity, target, tolerance, unit, linked output. Built-in quantity types:

| Quantity | Linked output |
|---|---|
| Belt speed | v from the chosen ratio and motor operating point |
| Throughput | boxes per minute |
| Box mass capacity | m_box used in T_e |
| Length, lift | L, H |
| Motor duty | percent of stall torque |
| Slip margin | T₂ setting ÷ T₂,min |
| Shaft safety factor | n from 3.7 |
| Motor power margin | available motor power at operating point ÷ required motor power |
| Custom | free text, checked manually |

Each row shows pass, fail or manual. The design record lists all rows.

## 5. Inputs and controls

| Input | Symbol | Unit | Range | Default |
|---|---|---|---|---|
| Box mass | m_box | kg | 0.01 to 100 | 1 |
| Box spacing | s | m | 0.05 to 10 | 0.3 |
| Target belt speed | v | m/s | 0.01 to 5 | 0.3 |
| Bed length | L | m | 0.2 to 20 | 2 |
| Lift | H | m | 0 to L | 0 |
| Belt mass per meter | m′_b | kg/m | 0.01 to 20 | 0.5 |
| Bed friction | μ | | 0.01 to 1 | 0.3 |
| Service factor | | | 1 to 3 | 1.5 |
| Drive efficiency | η | | 0.3 to 1 | 1.0 |
| Pulley diameter | D | mm | 10 to 1000 | 60 |
| Motor stall torque, no-load speed | T_s, N₀ | N·m, rpm | | 2, 300 |
| Chosen ratio | i | | | from solver |
| Pulley friction | μ_p | | 0.05 to 1 | 0.3 |
| Wrap angle | θ | degrees | 90 to 270 | 180 |
| Belt tension setting | T₂ | N | | 1.3 × T₂,min |
| Bearing span | L_b | mm | 10 to 2000 | 100 |
| Shaft diameter, yield strength | d, Sy | mm, MPa | | 8, 400 (placeholder) |

## 6. Interactions

1. Requirements tab first. The Design tab stays usable but shows "no requirements yet" until at least one row exists.
2. Design tab: sections in order, each collapsible, each with its own predict-first targets and show-the-working.
3. The side view drawing shows belt, boxes moving at v (to scale), pulleys, motor block, incline, T₁ and T₂ arrows and the shaft side load.
4. Changing any upstream input updates everything downstream and the requirement status column.
5. Export: design record (report), shaft-loads JSON, drive-request JSON, prediction log.

## 7. Outputs

- m′_p, throughput, T_e (with friction and lift parts shown separately), P, motor power needed
- T_p, N_p
- Motor operating point, loaded belt speed, speed error, duty band, ratio roots
- T₂,min, T₂ setting, T₁, slip margin
- Side load R, bearing loads, shaft M, T, τ_max, n
- Incline hold flag and backward pull
- Requirements pass or fail table
- Predict first targets: T_e, P, N_p, T₂,min, R, n

## 8. Test cases

| ID | Inputs | Expected |
|---|---|---|
| CD-1 | m_box = 1 kg, s = 0.3 m, v = 0.3 m/s, L = 2 m, H = 0, m′_b = 0.5 kg/m, μ = 0.3, D = 60 mm, SF 1.5, η = 1 | m′_p = 3.33 kg/m. Throughput 60 per minute. T_e = 22.6 N. P = 6.77 W. Motor power needed 10.2 W. T_p = 0.677 N·m. N_p = 95.5 rpm |
| CD-2 | CD-1 with L = 1 m, H = 0.5 m | T_e = 27.6 N (friction 11.3 N, lift 16.4 N). Backward pull 16.4 N. Incline flag shown |
| CD-3 | CD-1, μ_p = 0.3, θ = 180° | e^(0.3π) = 2.57. T₂,min = 14.4 N. With T₂ = T₂,min: T₁ = 37.0 N, R = 51.4 N |
| CD-4 | CD-1, θ = 210° | e^(μ_p θ) = 3.00. T₂,min = 11.3 N. T₁ = 33.8 N. R = 44.0 N |
| CD-5 | CD-1 with motor T_s = 2 N·m, N₀ = 300 rpm, ratio 3.14, η = 0.9 (set drive efficiency 0.9), load 0.68 N·m | Loaded pulley speed 84.0 rpm. Belt speed 0.264 m/s. Speed requirement 0.3 m/s ± 10%: fail (−12.0%) |
| CD-6 | CD-5 with solver ratio | i_high = 2.70. Belt speed 0.300 m/s. Speed requirement: pass |
| CD-7 | Shaft check: R = 51.4 N centered on L_b = 100 mm, T_p = 0.677 N·m, d = 8 mm, Sy = 400 MPa | M = 1.28 N·m. τ_max = 14.4 MPa. n = 13.8. Bearing loads 25.7 N each |
| CD-8 | H > L entered | Field message "Lift cannot be more than the bed length." |
| CD-9 | T₂ setting below T₂,min | Slip margin < 1, requirement fails, drawing marks the drive pulley "belt will slip" |
| CD-10 | Export shaft-loads JSON from CD-3 and import into the Shaft and Beam Workbench | One load of 51.4 N, torque 0.677 N·m. Workbench SB readouts match CD-7 when placed at the center of a 100 mm span |

Note for CD-5: belt speed = N_out × π D / 60 = 84.0 × π × 0.060 / 60 = 0.264 m/s.

## 9. Acceptance criteria

- [ ] All test cases pass in Node and in the interface.
- [ ] Design record prints on letter paper with the requirements table first, then each section's show-the-working, then sources.
- [ ] Every number in the design record carries a unit.
- [ ] The tool's embedded motor and shaft calculations produce identical results to files 02 and 01 for the same inputs (shared test fixtures).

## 10. Sources

- PackagingConveyor.com, conveyor engineering calculations: https://packagingconveyor.com/resources/conveyor-design-guide/conveyor-engineering/
- Rulmeca, how to calculate conveyor belt tensions: https://www.rulmeca.blog/question-and-answer/how-to-calculate-conveyor-belt-tensions/
- BisonConvey, capstan equation: https://bisonconvey.com/glossary/capstan-equation-eytelwein/
- Wikipedia, capstan equation: https://en.wikipedia.org/wiki/Capstan_equation
- Files 01 and 02 of this package for the shaft and motor models

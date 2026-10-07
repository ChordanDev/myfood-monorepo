# Narrow Onboarding Profile to profile fields, move restrictions/preferences to User Preferences

Status: proposed

The product glossary defined `Onboarding Profile` as including display name, restrictions, preferences, cooking skill, and household size. This slice narrows the captured `Onboarding Profile` to display name, household size, and cooking skill, and moves restrictions, diet, and soft preferences into a separate `User Preferences` entity that is captured in the same onboarding flow but stored and edited independently. Considered keeping the broader definition; rejected because combining the two entities in a single persistent record mixes profile and dietary data and complicates editability of preferences after onboarding. Reversing this decision later would require merging two user-facing screens and migrating a schema, so we record it now.

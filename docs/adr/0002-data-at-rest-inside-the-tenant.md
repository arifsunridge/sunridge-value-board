# Data at rest stays in the Sunridge tenant; Render only runs the app

All board data is stored inside the Sunridge Microsoft 365 tenant. Tasks, Areas and trails go in Microsoft Lists on a Sunridge SharePoint site, and files go in each Company's SharePoint document library. The app itself runs on Render as part of the HBF Portal, but stores nothing there. It reads and writes as the signed-in Member, so SharePoint permissions still apply. We picked this over a Render-hosted database, which is easier to build and query, because confidentiality comes first and this costs nothing extra at our scale.

## Considered options

- **Render database:** the simplest to build, but company data would sit outside the tenant.
- **Sunridge Azure (app and database):** a strong boundary, but more cost and setup, and it doesn't fit the Render-based HBF Portal.

## Consequences

- The app holds a link and metadata for each Document, never the file itself. Versions come from SharePoint.
- Microsoft Lists sets the ceiling: fine for thousands of Tasks, weak at complex queries. Reporting (the partner update in v2) has to work from simple filtered reads.
- Render still handles data in transit and may write logs. Logs must never contain Task content.
- When a Member uses Claude to read or update Tasks (P1), that content passes through Claude under Sunridge's existing agreement. It is processed outside the tenant but never stored by the board anywhere else.

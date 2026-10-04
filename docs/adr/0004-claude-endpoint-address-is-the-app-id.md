# Claude reaches the board at its own address, which is also the app's Application ID URI

Claude (chat and Claude Code) connects to the board's MCP endpoint at `https://<board domain>/mcp` and signs in with the Member's Microsoft account. When Claude asks Entra for a token, it names that address as the resource it wants. Entra accepts a resource only if it matches one of the app's Application ID URIs. So the app's Application ID URI is the endpoint address, not the usual `api://<client id>`, and the board's scope is `https://<board domain>/mcp/Board.ReadWrite`.

## Consequences

- The board needs a custom domain that Sunridge has verified in Microsoft 365, for example `board.sunridgepartners.com`. Entra won't accept an Application ID URI on Render's default `onrender.com` address.
- Changing the board's address later means changing the Application ID URI, and every Member reconnecting Claude. Choose the domain once.
- Entra can't register clients on the fly, so IT registers one client app for Claude. The claude.ai connector is added once by an Owner with that client's ID and secret. Claude Code uses the same client ID without a secret.

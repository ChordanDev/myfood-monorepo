defmodule MealPlannerApi.Mailer.EmailCodeEmail do
  @moduledoc """
  Verification-code email of the login and sign-up flows
  (`MealPlannerApi.Services.EmailCodeLogin`,
  `MealPlannerApi.Services.EmailCodeSignup`), and of the invite accept
  (`MealPlannerApi.AccountsMembership.request_invite_code/2`), whose code
  cannot sign in and so is not called a sign-in code.

  One email per issued code, carrying only the six-digit plaintext code
  (never the hash, never the user record). The plaintext is rendered
  in both a plain text body and an HTML body so the same template
  works in plain and rich mail clients.

  Body design:

    * Subject: "Your Myfood sign-in code", or "Your Myfood invite code"
      for an invite code.
    * Text body: a one-line "Your code is XXXXXX" with a short
      expiry note. Plaintext-only retrieval is rare but supported.
    * HTML body: the same value wrapped in a `<strong>` tag so the
      `~r/\b\d{6}\b/` regex in the tests reliably matches across
      both bodies without false positives from any other digits
      (such as the year).

  No plaintext code is logged or echoed anywhere outside the email
  itself (spec: "The system MUST NOT ... log code values").
  """
  import Bamboo.Email

  @from {"Myfood", "no-reply@myfood.app"}
  @type kind :: :sign_in | :invite

  @spec build(String.t(), String.t(), kind()) :: Bamboo.Email.t()
  def build(email_address, code, kind \\ :sign_in)
      when is_binary(email_address) and is_binary(code) and byte_size(code) == 6 and
             kind in [:sign_in, :invite] do
    new_email(
      from: @from,
      to: {display_name_for(email_address), email_address},
      subject: subject(kind),
      text_body: render_text(code, kind),
      html_body: render_html(code, kind)
    )
  end

  defp subject(:sign_in), do: "Your Myfood sign-in code"
  defp subject(:invite), do: "Your Myfood invite code"

  defp render_text(code, kind) do
    "#{lead(kind)} #{code}. It expires in 10 minutes and can only be used once."
  end

  defp render_html(code, kind) do
    """
    <p>#{lead(kind)} <strong>#{code}</strong>.</p>
    <p>It expires in 10 minutes and can only be used once.</p>
    """
  end

  defp lead(:sign_in), do: "Your Myfood sign-in code is"
  defp lead(:invite), do: "The code to accept your invite to Myfood is"

  # The Plaintext User is unknown to the service at the moment we
  # render this email; the only header we have is the address itself.
  # Use the local-part as a sensible default display name when no
  # User row has yet been loaded.
  defp display_name_for(email) when is_binary(email) do
    email
    |> String.split("@", parts: 2)
    |> hd()
  end
end

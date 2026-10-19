defmodule MealPlannerApi.EmailCodeDeliveryConcurrencyTest do
  @moduledoc """
  Two code requests for one email whose mails are out at the same time
  (issue #291): a code counts only once its mail is out, so the second
  request passes the cooldown while the first is being sent. Whichever
  is marked delivered last must consume the other, or a dead code keeps
  logging in for its whole TTL.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Persistence.Auth.{EmailAuthEvent, EmailVerificationCode}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeLogin

  @moduletag :runtime_db_concurrency
  unless MealPlannerApi.Issue38Database.enabled?() do
    @moduletag skip: "requires test/support/issue38_concurrency_runner.exs and a fresh database"
  end

  # Tells the test the mail is ready, then sends it when told to.
  defmodule GatedMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(email, config) do
      send(Process.get(:test_pid), {:mailing, self()})

      receive do
        :send -> Bamboo.LocalAdapter.deliver(email, config)
      after
        5000 -> raise "the mail was never released"
      end
    end

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  setup_all do
    repo =
      start_supervised!(
        {Repo,
         name: nil,
         database: MealPlannerApi.Issue38Database.database!(),
         pool: DBConnection.ConnectionPool,
         pool_size: 4,
         timeout: 10_000,
         parameters: [lock_timeout: "3000", statement_timeout: "8000"]}
      )

    {:ok, repo: repo}
  end

  setup %{repo: repo} do
    Repo.put_dynamic_repo(repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    Bamboo.SentEmail.reset()

    user =
      user_with_memberships(%{email: "overlap_#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :individual, name: "Overlapping sends"}, :owner}
      ])

    original_mailer = Application.fetch_env!(:meal_planner_api, MealPlannerApi.Mailer)
    Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, adapter: GatedMailAdapter)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, original_mailer)
      :telemetry.detach("pause-after-delivered-mark")
      Repo.put_dynamic_repo(repo)
      account_ids = Enum.map(user.memberships, & &1.account_id)
      Repo.delete_all(from(c in EmailVerificationCode, where: c.email == ^user.email))
      Repo.delete_all(from(e in EmailAuthEvent, where: e.email == ^user.email))
      Repo.delete_all(from(m in AccountMembership, where: m.user_id == ^user.id))
      Repo.delete_all(from(u in User, where: u.id == ^user.id))
      Repo.delete_all(from(a in Account, where: a.id in ^account_ids))
    end)

    {:ok, repo: repo, user: user}
  end

  test "the send marked delivered last consumes the other, so only its code logs in", f do
    # The first send stops right after it marks its code delivered, before
    # it commits, the window where the second send used to slip past it.
    :ok =
      :telemetry.attach(
        "pause-after-delivered-mark",
        [:meal_planner_api, :repo, :query],
        &__MODULE__.pause_after_delivered_mark/4,
        nil
      )

    first = request_in_task(f, pause_after_mark: true)
    assert_receive {:mailing, first_mailer}, 5000

    second = request_in_task(f, [])
    assert_receive {:mailing, second_mailer}, 5000

    send(first_mailer, :send)
    assert_receive {:marked_delivered, first_pid}, 5000

    send(second_mailer, :send)
    # The second mark waits for the first one to commit.
    refute Task.yield(second, 300)

    send(first_pid, :commit)
    assert {:ok, _sent} = Task.await(first, 5000)
    assert {:ok, _sent} = Task.await(second, 5000)

    assert [first_code, second_code] = mailed_codes()

    assert [%EmailVerificationCode{delivered_at: %DateTime{}}] =
             Repo.all(
               from(c in EmailVerificationCode,
                 where: c.email == ^f.user.email,
                 where: is_nil(c.consumed_at)
               )
             )

    assert {:error, :code_invalid} = verify(f.user, first_code)
    assert {:ok, _session} = verify(f.user, second_code)
  end

  @doc false
  def pause_after_delivered_mark(_event, _measurements, %{query: query}, _config) do
    if Process.get(:pause_after_mark, false) and query =~ ~s(SET "delivered_at") do
      Process.delete(:pause_after_mark)
      send(Process.get(:test_pid), {:marked_delivered, self()})

      receive do
        :commit -> :ok
      after
        5000 -> raise "the first mark was never released"
      end
    end
  end

  defp request_in_task(f, opts) do
    test_pid = self()

    Task.async(fn ->
      Repo.put_dynamic_repo(f.repo)
      Process.put(:test_pid, test_pid)
      if opts[:pause_after_mark], do: Process.put(:pause_after_mark, true)
      EmailCodeLogin.request_code(f.user.email, "203.0.113.1")
    end)
  end

  # The codes in the order their mails went out.
  defp mailed_codes do
    Bamboo.SentEmail.all()
    |> Enum.reverse()
    |> Enum.map(fn mail -> List.first(Regex.run(~r/\b\d{6}\b/, mail.text_body)) end)
  end

  defp verify(user, code) do
    EmailCodeLogin.verify_code(user.email, code, "203.0.113.1", fn user, membership ->
      {:ok, %{user: user, membership: membership}}
    end)
  end
end

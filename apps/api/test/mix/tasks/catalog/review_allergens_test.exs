defmodule Mix.Tasks.Catalog.ReviewAllergensTest do
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Repo
  alias Mix.Tasks.Catalog.ReviewAllergens

  @header "id,name,category,allergens_proposed,allergens,reviewed"

  setup do
    :ok = Sandbox.checkout(Repo)
    Mix.shell(Mix.Shell.Process)
    on_exit(fn -> Mix.shell(Mix.Shell.IO) end)
  end

  describe "--export" do
    @tag :tmp_dir
    test "lists exactly the unreviewed Ingredients with the proposal pre-filled and prints the count",
         %{tmp_dir: tmp_dir} do
      ravioles = insert("Ravioles, de \"verdura\"", nil, ["gluten", "egg"])
      rogel = insert("Rogel", nil, nil)
      insert("Queso", ["dairy"], ["dairy"])
      insert("Tomate", [], [])
      path = Path.join(tmp_dir, "review.csv")

      ReviewAllergens.run(["--export", path])

      assert File.read!(path) ==
               Enum.join(
                 [
                   @header,
                   ~s(#{ravioles.id},"Ravioles, de ""verdura""",otros,gluten egg,gluten egg,),
                   "#{rogel.id},Rogel,otros,,,",
                   ""
                 ],
                 "\n"
               )

      assert_received {:mix_shell, :info, [message]}
      assert message =~ "2 unreviewed Ingredients"
    end
  end

  describe "--apply" do
    @tag :tmp_dir
    test "writes allergens only on reviewed rows whose Ingredient is still unreviewed",
         %{tmp_dir: tmp_dir} do
      approved = insert("Approved", nil, ["gluten"])
      none = insert("None", nil, ["egg"])
      untouched = insert("Untouched", nil, ["soy"])
      not_yes = insert("Not yes", nil, [])
      already = insert("Already", ["dairy"], ["dairy"])

      path =
        write_csv(tmp_dir, [
          "#{approved.id},Approved,otros,gluten,gluten egg,yes",
          "#{none.id},None,otros,egg,, YES ",
          "#{untouched.id},Untouched,otros,soy,soy,",
          "#{not_yes.id},Not yes,otros,,dairy,no",
          "#{already.id},Already,otros,dairy,soy,yes"
        ])

      ReviewAllergens.run(["--apply", path])

      assert allergens(approved) == ["gluten", "egg"]
      assert allergens(none) == []
      assert allergens(untouched) == nil
      assert allergens(not_yes) == nil
      assert allergens(already) == ["dairy"]

      assert_received {:mix_shell, :info, [message]}
      assert message =~ "Wrote 2"
    end

    @tag :tmp_dir
    test "a file with any code outside the seven writes nothing and exits non-zero",
         %{tmp_dir: tmp_dir} do
      good = insert("Good", nil, [])
      bad = insert("Bad", nil, [])

      path =
        write_csv(tmp_dir, [
          "#{good.id},Good,otros,,gluten,yes",
          "#{bad.id},Bad,otros,,fish,"
        ])

      assert_raise Mix.Error, ~r/fish/, fn -> ReviewAllergens.run(["--apply", path]) end

      assert allergens(good) == nil
      assert allergens(bad) == nil
    end

    @tag :tmp_dir
    test "a code repeated in a cell is written once, not reported as unknown",
         %{tmp_dir: tmp_dir} do
      ingredient = insert("Repeated", nil, [])
      path = write_csv(tmp_dir, ["#{ingredient.id},Repeated,otros,,gluten gluten,yes"])

      ReviewAllergens.run(["--apply", path])

      assert allergens(ingredient) == ["gluten"]
    end

    @tag :tmp_dir
    test "an id that is not a canonical UUID writes nothing and exits non-zero",
         %{tmp_dir: tmp_dir} do
      good = insert("Good", nil, [])

      path =
        write_csv(tmp_dir, [
          "#{good.id},Good,otros,,gluten,yes",
          "0123456789abcdef,Raw bytes,otros,,soy,yes"
        ])

      assert_raise Mix.Error, ~r/"0123456789abcdef" is not an Ingredient id/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(good) == nil
    end

    @tag :tmp_dir
    test "accepts a file that starts with a byte order mark", %{tmp_dir: tmp_dir} do
      ingredient = insert("Spreadsheet", nil, [])
      path = write_csv(tmp_dir, ["#{ingredient.id},Spreadsheet,otros,,soy,yes"])
      File.write!(path, "\uFEFF" <> File.read!(path))

      ReviewAllergens.run(["--apply", path])

      assert allergens(ingredient) == ["soy"]
    end

    @tag :tmp_dir
    test "applies a file the export wrote, names with commas and quotes included",
         %{tmp_dir: tmp_dir} do
      tricky = insert("Tapa \"criolla\", de empanadas", nil, ["gluten"])
      path = Path.join(tmp_dir, "review.csv")
      ReviewAllergens.run(["--export", path])

      path
      |> File.read!()
      |> String.replace(~r/,gluten,$/m, ",gluten,yes")
      |> then(&File.write!(path, &1))

      ReviewAllergens.run(["--apply", path])

      assert allergens(tricky) == ["gluten"]
    end
  end

  test "without --export or --apply it exits non-zero" do
    assert_raise Mix.Error, ~r/--export/, fn -> ReviewAllergens.run([]) end
  end

  defp insert(name, allergens, proposed) do
    {:ok, ingredient} =
      Catalog.create_ingredient(%{
        name: name,
        category: :otros,
        allergens: allergens,
        allergens_proposed: proposed
      })

    ingredient
  end

  defp write_csv(tmp_dir, rows) do
    path = Path.join(tmp_dir, "review.csv")
    File.write!(path, Enum.join([@header | rows], "\n") <> "\n")
    path
  end

  defp allergens(ingredient),
    do: Repo.one!(from(i in Ingredient, where: i.id == ^ingredient.id, select: i.allergens))
end

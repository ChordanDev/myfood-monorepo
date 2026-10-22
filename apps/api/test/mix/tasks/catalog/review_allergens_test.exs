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

    @tag :tmp_dir
    test "pre-fills the proposed Diet marks", %{tmp_dir: tmp_dir} do
      merluza = insert("Merluza rebozada", nil, ["gluten", "egg", "fish"])
      path = Path.join(tmp_dir, "review.csv")

      ReviewAllergens.run(["--export", path])

      assert File.read!(path) ==
               "#{@header}\n#{merluza.id},Merluza rebozada,otros,gluten egg fish,gluten egg fish,\n"
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
    test "reports ids that match no Ingredient apart from Ingredients already reviewed",
         %{tmp_dir: tmp_dir} do
      fresh = insert("Fresh", nil, [])
      already = insert("Already", ["dairy"], ["dairy"])
      missing_id = Ecto.UUID.generate()

      path =
        write_csv(tmp_dir, [
          "#{fresh.id},Fresh,otros,,soy,yes",
          "#{already.id},Already,otros,dairy,dairy,yes",
          "#{missing_id},Deleted,otros,,egg,yes"
        ])

      ReviewAllergens.run(["--apply", path])

      assert allergens(fresh) == ["soy"]

      assert_received {:mix_shell, :info, [summary]}
      assert summary =~ "Wrote 1 reviewed Ingredients"
      assert summary =~ "skipped 1 already reviewed, 1 matching no Ingredient and 0 without"

      assert_received {:mix_shell, :info, [missing]}
      assert missing == "Ids that match no Ingredient: #{missing_id}"
    end

    @tag :tmp_dir
    test "a file with any code outside the Ingredient codes writes nothing and exits non-zero",
         %{tmp_dir: tmp_dir} do
      good = insert("Good", nil, [])
      bad = insert("Bad", nil, [])

      path =
        write_csv(tmp_dir, [
          "#{good.id},Good,otros,,gluten,yes",
          "#{bad.id},Bad,otros,,sesame,"
        ])

      assert_raise Mix.Error, ~r/sesame/, fn -> ReviewAllergens.run(["--apply", path]) end

      assert allergens(good) == nil
      assert allergens(bad) == nil
    end

    @tag :tmp_dir
    test "writes the Diet marks next to the Hard restriction codes, in catalog order",
         %{tmp_dir: tmp_dir} do
      milanesa = insert("Milanesa de carne", nil, ["gluten", "egg"])
      merluza = insert("Merluza", nil, [])
      miel = insert("Miel", nil, [])

      path =
        write_csv(tmp_dir, [
          "#{milanesa.id},Milanesa de carne,otros,gluten egg,meat gluten egg,yes",
          "#{merluza.id},Merluza,otros,,fish,yes",
          "#{miel.id},Miel,otros,,animal_product,yes"
        ])

      ReviewAllergens.run(["--apply", path])

      assert allergens(milanesa) == ["gluten", "egg", "meat"]
      assert allergens(merluza) == ["fish"]
      assert allergens(miel) == ["animal_product"]
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

  describe "--apply on a malformed file writes nothing and exits non-zero" do
    setup %{tmp_dir: tmp_dir} do
      # Every file below also holds this valid reviewed row; it must stay
      # unwritten because the file as a whole is rejected.
      valid = insert("Valid", nil, [])
      {:ok, valid: valid, valid_row: "#{valid.id},Valid,otros,,gluten,yes", tmp_dir: tmp_dir}
    end

    @tag :tmp_dir
    test "a malformed id", %{valid: valid, valid_row: valid_row, tmp_dir: tmp_dir} do
      path = write_csv(tmp_dir, [valid_row, "not-a-uuid,Bad,otros,,soy,yes"])

      assert_raise Mix.Error, ~r/row 3: "not-a-uuid" is not an Ingredient id/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
    end

    @tag :tmp_dir
    test "a header that differs from the export's",
         %{valid: valid, valid_row: valid_row, tmp_dir: tmp_dir} do
      path =
        write_raw(
          tmp_dir,
          "id,name,category,allergens,allergens_proposed,reviewed\n#{valid_row}\n"
        )

      assert_raise Mix.Error, ~r/the header must be #{@header}/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
    end

    @tag :tmp_dir
    test "a ;-separated file, as a Spanish-locale spreadsheet saves it",
         %{valid: valid, tmp_dir: tmp_dir} do
      path =
        write_raw(
          tmp_dir,
          "id;name;category;allergens_proposed;allergens;reviewed\n" <>
            "#{valid.id};Valid;otros;;gluten;yes\n"
        )

      assert_raise Mix.Error, ~r/the header must be #{@header}/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
    end

    @tag :tmp_dir
    test "a row with the wrong number of columns",
         %{valid: valid, valid_row: valid_row, tmp_dir: tmp_dir} do
      short = insert("Short", nil, [])
      path = write_csv(tmp_dir, [valid_row, "#{short.id},Short,otros,soy,yes"])

      assert_raise Mix.Error, ~r/row 3: expected 6 columns, got 5/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
      assert allergens(short) == nil
    end

    @tag :tmp_dir
    test "a quoted field that never closes",
         %{valid: valid, valid_row: valid_row, tmp_dir: tmp_dir} do
      open = insert("Open", nil, [])
      path = write_csv(tmp_dir, [valid_row, ~s(#{open.id},"Open,otros,,soy,yes)])

      assert_raise Mix.Error, ~r/quoted field that never closes/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
      assert allergens(open) == nil
    end

    @tag :tmp_dir
    test "invalid UTF-8", %{valid: valid, valid_row: valid_row, tmp_dir: tmp_dir} do
      latin1 = insert("Latin1", nil, [])
      path = write_csv(tmp_dir, [valid_row, "#{latin1.id},Lim\xF3n,otros,,soy,yes"])

      assert_raise Mix.Error, ~r/is not valid UTF-8/, fn ->
        ReviewAllergens.run(["--apply", path])
      end

      assert allergens(valid) == nil
      assert allergens(latin1) == nil
    end

    # An empty file cannot hold the valid row; the Ingredient still stays unreviewed.
    @tag :tmp_dir
    test "an empty file", %{valid: valid, tmp_dir: tmp_dir} do
      path = write_raw(tmp_dir, "")

      assert_raise Mix.Error, ~r/is empty/, fn -> ReviewAllergens.run(["--apply", path]) end

      assert allergens(valid) == nil
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

  defp write_raw(tmp_dir, content) do
    path = Path.join(tmp_dir, "review.csv")
    File.write!(path, content)
    path
  end

  defp allergens(ingredient),
    do: Repo.one!(from(i in Ingredient, where: i.id == ^ingredient.id, select: i.allergens))
end

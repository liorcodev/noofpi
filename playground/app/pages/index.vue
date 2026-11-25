<script setup lang="ts">
const { data: greeting } = useAsyncData("greeting", async () => ({
  message: "Hello from the server",
  items: [1, 2, 3, 4, 5],
}));
const visits = useState("visits", () => 1);
const fail = () => {
  throw new Error("Thrown from a click handler");
};
</script>

<template>
  <main class="grid min-h-screen place-items-center">
    <div class="text-center">
      <h1 class="text-2xl font-semibold">noofpi</h1>
      <p>{{ greeting?.message }} ({{ visits }} visit)</p>
      <nav class="mt-4 flex gap-4">
        <NoofpiLink to="/about">about</NoofpiLink>
        <NoofpiLink to="/users/42">user 42</NoofpiLink>
        <a href="/crash">crash (server)</a>
        <button type="button" @click="fail">crash (browser)</button>
      </nav>
    </div>
  </main>
</template>

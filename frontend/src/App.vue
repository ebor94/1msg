<script setup>
import { useAuth } from './stores/auth';
useAuth().cargarDeStorage();
</script>

<template>
  <router-view />
</template>

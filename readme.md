# **📅 Good Calendar**

## **🎯 Goal of the Project**

The primary goal of **Good Calendar** is to create a robust, multi-user calendar application equipped with a dedicated permissions system.  
A core focus of this project is smart schedule management: the system is designed to warn users about potential scheduling conflicts. If an appointment booked in the **Office** calendar overlaps with an event scheduled in the **Personal** calendar, the system will alert the user while still allowing the bookings to overlap. This encourages a clean separation of work and private life while maintaining flexibility for the user.

## **🛠️ Technology Stack**

This project is built using a modern, containerized architecture that separates the frontend, backend, and database for maximum scalability and maintainability.

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (A lightweight, fast, and easily testable UI without heavy bundlers)  
* **Backend:** Node.js with Express.js  
* **Database:** MySQL  
* **Authentication:** JSON Web Tokens (JWT) for secure user sessions  
* **Infrastructure:** Docker & Docker Compose (Containerized for consistent environments)

## **⚙️ Configuration & Setup**

Getting the project up and running is straightforward thanks to Docker. Follow these steps to configure and launch the application locally:

### **Prerequisites**

* Ensure you have [Docker](https://www.docker.com/products/docker-desktop/) installed and running on your machine.  
* Git installed on your machine.

### **Installation Steps**

1. **Clone the repository**  
   Open your terminal and clone the project to your local machine:  
   ```bash
   git clone \[https://github.com/diegoturchetto25-tech/good-calendar.git\](https://github.com/diegoturchetto25-tech/good-calendar.git)```

2. **Navigate to the project directory**  
   ```bash
   cd good-calendar
   ```

3. **Build and start the containers**  
   Use Docker Compose to build the images and start the database, backend, and frontend services simultaneously:  
   ```bash
   docker-compose up -d
   ```

4. **Access the application**  
   Once the containers are running, open your web browser and navigate to: 
   ```bash
   http://localhost
   ```

5. **Test the Application**  
   You can log in and test the application using the following default mock credentials provisioned in the database:

| Email | Password |
| :---- | :---- |
| `admin@calendar.local` | `password` |
| `mario.rossi@test.local` | `password` |
| `luisa.verdi@test.local` | `password` |
| `diego.turchetto@test.local` | `password` |
| `daniele.gobbo@test.local` | `password` |

### **Stopping the Application**

To stop the running containers, run the following command in another terminal window within the project directory:  
```bash
docker-compose down
```

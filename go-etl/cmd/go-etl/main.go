package main

import (
	"fmt"
	"log"
	"os"

	"github.com/spf13/cobra"
	"github.com/nate/ghost-stops/go-etl/internal/chicago"
	"github.com/nate/ghost-stops/go-etl/internal/compute"
	"github.com/nate/ghost-stops/go-etl/internal/db"
)

var (
	city   string
	source string
	gtfs   string
	ridership string
)

var rootCmd = &cobra.Command{
	Use:   "go-etl",
	Short: "Ghost Stops ETL tool for transit data",
	Long:  `ETL tool to ingest GTFS and ridership data, compute ghost scores, and populate the database.`,
}

var gtfsCmd = &cobra.Command{
	Use:   "gtfs",
	Short: "Ingest GTFS data for a city",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" || source == "" {
			log.Fatal("--city and --source are required")
		}

		dbClient, err := db.NewClient(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		switch city {
		case "chicago":
			err = chicago.IngestGTFS(dbClient, source)
			if err != nil {
				log.Fatalf("Failed to ingest Chicago GTFS: %v", err)
			}
			fmt.Println("✅ Chicago GTFS data ingested successfully")
		default:
			log.Fatalf("Unsupported city: %s", city)
		}
	},
}

var ridershipCmd = &cobra.Command{
	Use:   "ridership",
	Short: "Ingest ridership data for a city",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" || source == "" {
			log.Fatal("--city and --source are required")
		}

		dbClient, err := db.NewClient(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		switch city {
		case "chicago":
			err = chicago.IngestRidership(dbClient, source)
			if err != nil {
				log.Fatalf("Failed to ingest Chicago ridership: %v", err)
			}
			fmt.Println("✅ Chicago ridership data ingested successfully")
		default:
			log.Fatalf("Unsupported city: %s", city)
		}
	},
}

var computeCmd = &cobra.Command{
	Use:   "compute",
	Short: "Compute ghost scores and metrics for a city",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" {
			log.Fatal("--city is required")
		}

		dbClient, err := db.NewClient(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		switch city {
		case "chicago":
			err = compute.ComputeGhostScores(dbClient, "chicago")
			if err != nil {
				log.Fatalf("Failed to compute ghost scores: %v", err)
			}
			fmt.Println("✅ Ghost scores computed successfully")
		default:
			log.Fatalf("Unsupported city: %s", city)
		}
	},
}

var allCmd = &cobra.Command{
	Use:   "all",
	Short: "Run all ETL steps for a city",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" || gtfs == "" || ridership == "" {
			log.Fatal("--city, --gtfs, and --ridership are required")
		}

		dbClient, err := db.NewClient(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		switch city {
		case "chicago":
			// Step 1: Ingest GTFS
			fmt.Println("📍 Ingesting Chicago GTFS data...")
			err = chicago.IngestGTFS(dbClient, gtfs)
			if err != nil {
				log.Fatalf("Failed to ingest Chicago GTFS: %v", err)
			}

			// Step 2: Ingest ridership
			fmt.Println("📊 Ingesting Chicago ridership data...")
			err = chicago.IngestRidership(dbClient, ridership)
			if err != nil {
				log.Fatalf("Failed to ingest Chicago ridership: %v", err)
			}

			// Step 3: Compute ghost scores
			fmt.Println("👻 Computing ghost scores...")
			err = compute.ComputeGhostScores(dbClient, "chicago")
			if err != nil {
				log.Fatalf("Failed to compute ghost scores: %v", err)
			}

			fmt.Println("✅ All ETL steps completed successfully!")
		default:
			log.Fatalf("Unsupported city: %s", city)
		}
	},
}


var syncRidershipCmd = &cobra.Command{
	Use:   "sync-ridership",
	Short: "Syncs CTA ridership data from the Socrata API",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" {
			log.Fatal("--city is required")
		}

		databaseURL := os.Getenv("DATABASE_URL")
		if databaseURL == "" {
			log.Fatal("DATABASE_URL environment variable is required")
		}

		appToken := os.Getenv("CHICAGO_DATA_APP_TOKEN")
		if appToken == "" {
			log.Println("Warning: CHICAGO_DATA_APP_TOKEN not set, proceeding without app token")
		}

		dbClient, err := db.NewClient(databaseURL)
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		days, _ := cmd.Flags().GetInt("days")
		since, _ := cmd.Flags().GetString("since")
		limit, _ := cmd.Flags().GetInt("limit")

		opts := chicago.SyncOpts{
			Days:  days,
			Since: since,
			Limit: limit,
		}

		switch city {
		case "chicago":
			err := chicago.SyncRidership(dbClient, appToken, opts)
			if err != nil {
				log.Fatalf("Failed to sync Chicago ridership: %v", err)
			}
			fmt.Println("✅ Chicago ridership data synced successfully")
		default:
			log.Fatalf("Unsupported city: %s", city)
		}
	},
}


var listStationsCmd = &cobra.Command{
	Use:   "list-stations",
	Short: "List all station names for a city",
	Run: func(cmd *cobra.Command, args []string) {
		if city == "" {
			log.Fatal("--city is required")
		}


		dbClient, err := db.NewClient(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer dbClient.Close()

		cityID, err := dbClient.GetCityID(city, "")
		if err != nil {
			log.Fatalf("Failed to get city ID: %v", err)
		}

		names, err := dbClient.GetAllStationNames(cityID)
		if err != nil {
			log.Fatalf("Failed to get station names: %v", err)
		}

		fmt.Printf("Stations for %s:\n", city)
		for _, name := range names {
			fmt.Println(name)
		}
	},
}

func init() {
	// GTFS command flags
	gtfsCmd.Flags().StringVar(&city, "city", "", "City code (e.g., chicago)")
	gtfsCmd.Flags().StringVar(&source, "source", "", "GTFS data source (URL or local file)")

	// Ridership command flags
	ridershipCmd.Flags().StringVar(&city, "city", "", "City code (e.g., chicago)")
	ridershipCmd.Flags().StringVar(&source, "source", "", "Ridership data source (URL or local file)")

	// Compute command flags
	computeCmd.Flags().StringVar(&city, "city", "", "City code (e.g., chicago)")

	// All command flags
	allCmd.Flags().StringVar(&city, "city", "", "City code (e.g., chicago)")
	allCmd.Flags().StringVar(&gtfs, "gtfs", "", "GTFS data source (URL or local file)")
	allCmd.Flags().StringVar(&ridership, "ridership", "", "Ridership data source (URL or local file)")

	// List stations command flags
	listStationsCmd.Flags().StringVar(&city, "city", "", "City code (e.g., chicago)")

	// Sync ridership command flags
	syncRidershipCmd.Flags().StringVar(&city, "city", "chicago", "City code (e.g., chicago)")
	syncRidershipCmd.Flags().Int("days", 365, "Retention period in days")
	syncRidershipCmd.Flags().String("since", "", "Override start date (YYYY-MM-DD)")
	syncRidershipCmd.Flags().Int("limit", 50000, "Socrata page size")

	// Add commands to root
	rootCmd.AddCommand(gtfsCmd)
	rootCmd.AddCommand(ridershipCmd)
	rootCmd.AddCommand(computeCmd)
	rootCmd.AddCommand(allCmd)
	rootCmd.AddCommand(listStationsCmd)
	rootCmd.AddCommand(syncRidershipCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}